import {
	buildAuditEvent,
	classifyToolCall,
	createActionCandidate,
} from "../executionGateway";
import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import {
	type LlmClampedDecision,
	type LlmJudgeConfig,
} from "../llmDecisionContracts";
import {
	evaluateLlmMetadata,
	resolveLlmConfig,
} from "../llmDecisionAdapter";
import { sanitizeLlmJudgeInput } from "../llmDecisionSanitizer";
import * as priceQuote from "../priceQuote";
import type { UsdcSolQuoteQuery } from "../priceQuote";
import * as swapGateway from "../swapGateway";
import type { EvaluateSwapGatewayInput } from "../swapGatewayContracts";
import * as transferGateway from "../transferGateway";
import type { EvaluateTransferGatewayInput } from "../transferGatewayContracts";
import { buildSolTransferTransactionPayload } from "../transferTransactionPayload";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";
import { createSignerAdapter } from "../signerAdapter";
import { executeMcpTransfer } from "./internalExecutor";
import { recordMcpAuditEvent } from "./mcpAuditSink";
import {
	MCP_TOOL_NAMES,
	type CompassMcpToolCallInput,
	type CompassMcpToolRegistryEntry,
	type CompassMcpToolResult,
	type McpSupportedNetwork,
} from "./mcpToolContracts";
import { getMcpTool } from "./mcpToolRegistry";
import {
	buildAllowResult,
	buildDenyResult,
	buildRequireAdditionalContextResult,
	buildRequireApprovalResult,
} from "./mcpToolResults";

const DEFAULT_NETWORK = "devnet";
const MCP_AUDIT_ACTION_KIND_PREFIX = "mcp_tool_call";
const MCP_SUPPORTED_NETWORKS = ["devnet", "testnet", "mainnet-beta"] as const;

/**
 * Internal-only tool names that must not be called through the public MCP router.
 * These tools are hidden from listMcpTools and must be rejected if a client
 * attempts to call them directly.
 */
const INTERNAL_TOOL_NAMES: ReadonlySet<string> = new Set([
	MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
	MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
	MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL,
	MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
	MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION,
]);

/**
 * Optional LLM metadata enrichment after deterministic evaluation.
 *
 * If LLM config is missing/disabled, returns the deterministic result unchanged.
 * If enabled, calls the LLM judge and clamps the result so deterministic DENY
 * cannot be loosened. Audit metadata is always attached when LLM is consulted.
 */
async function enrichWithLlmMetadata(
	deterministicDecision: (typeof COMPASS_DECISIONS)[keyof typeof COMPASS_DECISIONS],
	riskClass: string,
	classification: ReturnType<typeof classifyToolCall>,
	registryEntry: CompassMcpToolRegistryEntry | undefined,
	network: string | undefined,
	reasonCodes: string[],
	policyId?: string,
	evaluatedRules?: string[],
): Promise<{ llmMetadata: LlmClampedDecision | undefined }> {
	const config: LlmJudgeConfig = resolveLlmConfig();

	if (!config.enabled) {
		return { llmMetadata: undefined };
	}

	const sanitizedInput = sanitizeLlmJudgeInputFromContext(
		deterministicDecision,
		riskClass,
		classification,
		registryEntry,
		network,
		reasonCodes,
		policyId,
		evaluatedRules,
	);

	const llmResult = await evaluateLlmMetadata({
		input: sanitizedInput,
		config,
	});

	if (llmResult.llmConsulted && llmResult.llmOutput) {
		const auditId = recordMcpAuditEvent(
			buildAuditEvent({
				candidate: createActionCandidate({
					chain: "solana",
					network: network ?? DEFAULT_NETWORK,
					toolName: registryEntry?.classificationToolName ?? "unknown",
					actionKind: `${MCP_AUDIT_ACTION_KIND_PREFIX}.${registryEntry?.actionKind ?? "unknown"}`,
					params: {
						llmDecision: llmResult.decision,
						llmClamped: llmResult.clamped,
						llmConfidence: llmResult.llmOutput.confidence,
						llmReasonCodes: llmResult.llmOutput.reasonCodes,
					},
				}),
				classification: {
					...classification,
					toolName: registryEntry?.classificationToolName ?? "unknown",
				},
				decision: deterministicDecision,
				result: "success",
				metadata: {
					llmConsulted: true,
					llmDecision: llmResult.decision,
					llmClamped: llmResult.clamped,
					llmRationale: llmResult.llmRationale,
				},
			}),
		);

		void auditId; // audit recorded for traceability
	}

	return { llmMetadata: llmResult.llmConsulted ? llmResult : undefined };
}

function sanitizeLlmJudgeInputFromContext(
	deterministicDecision: (typeof COMPASS_DECISIONS)[keyof typeof COMPASS_DECISIONS],
	riskClass: string,
	classification: ReturnType<typeof classifyToolCall>,
	registryEntry: CompassMcpToolRegistryEntry | undefined,
	network: string | undefined,
	reasonCodes: string[],
	policyId?: string,
	evaluatedRules?: string[],
) {
	return sanitizeLlmJudgeInput({
		toolName: registryEntry?.classificationToolName ?? "unknown",
		actionKind: registryEntry?.actionKind ?? "unknown",
		network: network ?? DEFAULT_NETWORK,
		deterministicDecision,
		riskClass,
		reasonCodes,
		policyId,
		evaluatedRules,
	});
}

type SupportedNetwork = (typeof MCP_SUPPORTED_NETWORKS)[number];

function isMcpSupportedNetwork(value: string): value is SupportedNetwork {
	return MCP_SUPPORTED_NETWORKS.includes(value as SupportedNetwork);
}

function networkToRpcUrl(network: string): string {
	if (network === "mainnet-beta") {
		return "https://api.mainnet-beta.solana.com";
	}

	if (network === "testnet") {
		return "https://api.testnet.solana.com";
	}

	return "https://api.devnet.solana.com";
}

async function applyDefaultActorWallet<
	T extends { actorWallet?: string; network: string },
>(input: T): Promise<T> {
	if (input.actorWallet) {
		return input;
	}

	const signer = createSignerAdapter({ rpcUrl: networkToRpcUrl(input.network) });
	if (!signer.ok) {
		return input;
	}

	return {
		...input,
		actorWallet: await signer.adapter.getAddress(),
	};
}

// ---------------------------------------------------------------------------
// Public MCP router entry point
// ---------------------------------------------------------------------------

export async function handleMcpToolCall(
	input: CompassMcpToolCallInput,
): Promise<CompassMcpToolResult> {
	const registryEntry = getMcpTool(input.toolName);
	const classification = classifyToolCall({
		toolName: registryEntry?.classificationToolName ?? input.toolName,
		mutates: registryEntry?.mutates ?? input.mutates,
	});

	// Unknown/unregistered tool: fail closed
	if (!registryEntry) {
		const auditId = emitMcpAudit({
			publicToolName: input.toolName,
			actionKind: "unknown",
			classification,
			decision: classification.defaultDecision,
			result:
				classification.defaultDecision === COMPASS_DECISIONS.DENY
					? "denied"
					: "pending",
			metadata: { registeredTool: false },
		});

		if (classification.defaultDecision === COMPASS_DECISIONS.DENY) {
			return buildDenyResult({
				toolName: input.toolName,
				riskClass: classification.riskClass,
				reasonCodes: classification.reasonCodes,
				message: "Compass denied an unknown mutating MCP tool fail-closed.",
				auditId,
			});
		}

		return buildRequireAdditionalContextResult({
			toolName: input.toolName,
			riskClass: classification.riskClass,
			reasonCodes: classification.reasonCodes,
			message: "Compass requires additional context for this unknown MCP tool.",
			auditId,
		});
	}

	// Reject all hidden/internal tools before any routing
	if (INTERNAL_TOOL_NAMES.has(registryEntry.name)) {
		return denyRegisteredTool(registryEntry, classification.reasonCodes);
	}

	if (classification.defaultDecision === COMPASS_DECISIONS.DENY) {
		return denyRegisteredTool(registryEntry, classification.reasonCodes);
	}

	// Public routing
	switch (registryEntry.name) {
		case MCP_TOOL_NAMES.GET_USDC_SOL_QUOTE:
		case MCP_TOOL_NAMES.QUOTE_SWAP:
			return handleQuoteTool(
				registryEntry,
				classification.reasonCodes,
				input.arguments,
			);
		case MCP_TOOL_NAMES.SIMULATE_CONDITIONAL_BUY_ORACLE_CHECK:
			return handleConditionalOracleSimulationTool(
				registryEntry,
				classification.reasonCodes,
				input.arguments,
			);
		case MCP_TOOL_NAMES.COMPASS_TRANSFER:
			return handleCompassTransfer(registryEntry, input.arguments);
		case MCP_TOOL_NAMES.COMPASS_SWAP:
			return handleCompassSwap(registryEntry, input.arguments);
		default:
			// Fallback for any registered tool not explicitly handled
			return denyRegisteredTool(registryEntry, classification.reasonCodes);
	}
}

// ---------------------------------------------------------------------------
// Deny helper — message guides to compass_transfer / compass_swap
// ---------------------------------------------------------------------------

function denyRegisteredTool(
	registryEntry: CompassMcpToolRegistryEntry,
	reasonCodes: string[],
): CompassMcpToolResult {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const auditId = emitMcpAudit({
		publicToolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification,
		decision: COMPASS_DECISIONS.DENY,
		result: "denied",
		metadata: { registeredTool: true },
	});

	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes,
		message:
			"This tool is unavailable through the public Compass MCP surface. Route actions through compass_transfer or compass_swap instead.",
		auditId,
	});
}

// ---------------------------------------------------------------------------
// Compass Transfer — E2E flow
// ---------------------------------------------------------------------------

async function handleCompassTransfer(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseCompassTransferInput(args);

	if (parsed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			metadata: {
				registeredTool: true,
				validationErrors: parsed.reasonCodes,
			},
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: parsed.reasonCodes,
			message: "Compass requires valid transfer amount and recipient context.",
			auditId,
		});
	}

	const transferInput = await applyDefaultActorWallet(parsed.value);

	// Non-devnet is blocked BEFORE gateway/payload/signing regardless of
	// policy decision or userConfirmedRisk. External production approval is
	// always required outside devnet.
	if (transferInput.network !== "devnet") {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: transferInput.network,
			metadata: {
				registeredTool: true,
				transferNetwork: transferInput.network,
				userConfirmedRisk: parsed.value.userConfirmedRisk,
				reason: "NON_DEVNET_EXECUTION_BLOCKED",
			},
		});

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: ["NON_DEVNET_EXECUTION_BLOCKED"],
			message:
				"Compass blocks non-devnet transfers. External production approval is required for testnet and mainnet-beta execution. userConfirmedRisk is only valid on devnet.",
			auditId,
		});
	}

	// Evaluate transfer gateway (deterministic policy)
	const evaluation = await transferGateway.evaluateTransferGateway({
		...transferInput,
		toolName: registryEntry.classificationToolName,
	});
	const deterministicDecision = evaluation.policyEvaluation.decision;
	const reasonCodes = evaluation.policyEvaluation.reasonCodes;

	// LLM metadata enrichment — never loosens deterministic DENY
	const { llmMetadata } = await enrichWithLlmMetadata(
		deterministicDecision,
		evaluation.classification.riskClass,
		evaluation.classification,
		registryEntry,
		transferInput.network,
		reasonCodes,
		evaluation.policyEvaluation.policyId,
		evaluation.policyEvaluation.evaluatedRules,
	);
	const decision = llmMetadata?.clamped
		? llmMetadata.decision
		: deterministicDecision;

	const auditId = emitMcpAudit({
		publicToolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification: evaluation.classification,
		decision,
		result: decision === COMPASS_DECISIONS.DENY ? "denied" : "pending",
		network: transferInput.network,
		metadata: {
			registeredTool: true,
			policyId: evaluation.policyEvaluation.policyId,
			policyReasonCodes: reasonCodes,
			evaluatedRules: evaluation.policyEvaluation.evaluatedRules,
			proposalEligible: evaluation.proposalEligible,
			requiresApprovalCard: evaluation.requiresApprovalCard,
			failClosedReason: evaluation.failClosedReason,
			gatewayCandidateId: evaluation.metadata.candidateId,
			candidateFingerprint: evaluation.metadata.candidateFingerprint,
			contextFingerprint: evaluation.metadata.contextFingerprint,
			userConfirmedRisk: parsed.value.userConfirmedRisk,
			...(llmMetadata?.llmConsulted
				? {
						llmConsulted: true,
						llmDecision: llmMetadata.decision,
						llmClamped: llmMetadata.clamped,
					}
				: {}),
		},
		params: {
			amountSol: transferInput.amountSol,
			recipientAddress: transferInput.recipientAddress,
			recipientKnown: transferInput.recipientKnown,
		},
	});

	// DENY — return clear denial without building/executing
	if (decision === COMPASS_DECISIONS.DENY) {
		const resultData: Record<string, unknown> = {
			proposalEligible: evaluation.proposalEligible,
			requiresApprovalCard: evaluation.requiresApprovalCard,
			failClosedReason: evaluation.failClosedReason,
			policyId: evaluation.policyEvaluation.policyId,
		};
		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: resultData,
			auditId,
		});
	}

	// REQUIRE_ADDITIONAL_CONTEXT — return missing context result without executing
	if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
		const resultData: Record<string, unknown> = {
			proposalEligible: evaluation.proposalEligible,
			requiresApprovalCard: evaluation.requiresApprovalCard,
			failClosedReason: evaluation.failClosedReason,
			policyId: evaluation.policyEvaluation.policyId,
		};
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: resultData,
			auditId,
		});
	}

	// REQUIRE_HUMAN_APPROVAL — on devnet, check userConfirmedRisk
	if (decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL) {
		// Devnet + userConfirmedRisk=false: ask for confirmation, do NOT expose payload
		if (!parsed.value.userConfirmedRisk) {
			const resultData: Record<string, unknown> = {
				proposalEligible: evaluation.proposalEligible,
				requiresApprovalCard: evaluation.requiresApprovalCard,
				failClosedReason: evaluation.failClosedReason,
				policyId: evaluation.policyEvaluation.policyId,
			};
			return buildRequireApprovalResult({
				toolName: registryEntry.name,
				riskClass: registryEntry.metadata.riskClass,
				reasonCodes,
				data: resultData,
				approval: {
					required: true,
					metadata: evaluation.metadata,
				},
				auditId,
			});
		}

		// Devnet + userConfirmedRisk=true: continue to execution
	}

	// ALLOW or REQUIRE_HUMAN_APPROVAL with userConfirmedRisk on devnet:
	// Build the transfer payload and execute via internalExecutor
	const transferPayload = await buildSolTransferTransactionPayload({
		candidateId: evaluation.metadata.candidateId,
		network: transferInput.network,
		sourceWallet: transferInput.actorWallet!,
		recipientAddress: transferInput.recipientAddress,
		amountSol: transferInput.amountSol,
		rpcUrl: networkToRpcUrl(transferInput.network),
	});

	if (transferPayload.ok === false) {
		// Payload build failed — return an error without executing
		const resultData: Record<string, unknown> = {
			proposalEligible: evaluation.proposalEligible,
			requiresApprovalCard: evaluation.requiresApprovalCard,
			failClosedReason: evaluation.failClosedReason,
			policyId: evaluation.policyEvaluation.policyId,
			executionPayloadStatus: "unavailable",
			executionPayloadReason: transferPayload.reason,
		};
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: [...reasonCodes, "TRANSFER_PAYLOAD_BUILD_FAILED"],
			data: resultData,
			auditId,
		});
	}

	// Record the payload in the pending store so internalExecutor can verify it
	defaultPendingTransactionStore.record({
		candidateId: evaluation.metadata.candidateId,
		actionHash: transferPayload.payload.actionHash,
		unsignedVersionedTransaction:
			transferPayload.payload.unsignedVersionedTransaction,
		network: transferInput.network,
		tool: "compass_transfer",
		action: "transfer",
	});

	// Execute via internal executor (devnet bypass for approval)
	const executionResult = await executeMcpTransfer({
		candidateId: evaluation.metadata.candidateId,
		network: transferInput.network as McpSupportedNetwork,
		transactionPayload: transferPayload.payload,
		toolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification,
		riskClass: registryEntry.metadata.riskClass,
	});

	if (executionResult.ok) {
		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: {
				signerPath: executionResult.signerPath,
				signature: executionResult.signature,
				executionStatus: "executed",
			},
			auditId: executionResult.auditId,
		});
	}

	// Execution failed
	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes: executionResult.reasonCodes ?? reasonCodes,
		data: {
			signerPath: executionResult.signerPath,
			executionStatus: "failed",
		},
		auditId: executionResult.auditId,
	});
}

// ---------------------------------------------------------------------------
// Compass Swap — policy-only flow (no execution)
// ---------------------------------------------------------------------------

async function handleCompassSwap(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseCompassSwapInput(args);

	if (parsed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			metadata: {
				registeredTool: true,
				validationErrors: parsed.reasonCodes,
			},
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: parsed.reasonCodes,
			message:
				"Compass requires valid swap amount, slippage, protocol, and token context.",
			auditId,
		});
	}

	const swapInput = await applyDefaultActorWallet(parsed.value);

	// Evaluate swap gateway (deterministic policy)
	const evaluation = await swapGateway.evaluateSwapGateway({
		...swapInput,
		toolName: registryEntry.classificationToolName,
	});
	const deterministicDecision = evaluation.policyEvaluation.decision;
	const reasonCodes = evaluation.policyEvaluation.reasonCodes;

	// LLM metadata enrichment — never loosens deterministic DENY
	const { llmMetadata } = await enrichWithLlmMetadata(
		deterministicDecision,
		evaluation.classification.riskClass,
		evaluation.classification,
		registryEntry,
		swapInput.network,
		reasonCodes,
		evaluation.policyEvaluation.policyId,
		evaluation.policyEvaluation.evaluatedRules,
	);
	const decision = llmMetadata?.clamped
		? llmMetadata.decision
		: deterministicDecision;

	const auditId = emitMcpAudit({
		publicToolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification: evaluation.classification,
		decision,
		result: decision === COMPASS_DECISIONS.DENY ? "denied" : "pending",
		network: swapInput.network,
		metadata: {
			registeredTool: true,
			policyId: evaluation.policyEvaluation.policyId,
			policyReasonCodes: reasonCodes,
			evaluatedRules: evaluation.policyEvaluation.evaluatedRules,
			proposalEligible: evaluation.proposalEligible,
			requiresApprovalCard: evaluation.requiresApprovalCard,
			failClosedReason: evaluation.failClosedReason,
			gatewayCandidateId: evaluation.metadata.candidateId,
			candidateFingerprint: evaluation.metadata.candidateFingerprint,
			contextFingerprint: evaluation.metadata.contextFingerprint,
			protocol: parsed.value.protocol,
			slippageBps: parsed.value.slippageBps,
			tokenKnown: parsed.value.tokenKnown,
			...(llmMetadata?.llmConsulted
				? {
						llmConsulted: true,
						llmDecision: llmMetadata.decision,
						llmClamped: llmMetadata.clamped,
					}
				: {}),
		},
		params: {
			inputToken: parsed.value.inputToken,
			outputToken: parsed.value.outputToken,
			inputAmount: parsed.value.inputAmount,
			slippageBps: parsed.value.slippageBps,
			protocol: parsed.value.protocol,
			tokenMint: parsed.value.tokenMint,
		},
	});

	// Build swap result data — never includes transaction/execution payloads
	const swapResultData: Record<string, unknown> = {
		proposalEligible: evaluation.proposalEligible,
		requiresApprovalCard: evaluation.requiresApprovalCard,
		failClosedReason: evaluation.failClosedReason,
		policyId: evaluation.policyEvaluation.policyId,
		executionStatus: "pending_builder",
	};

	// Swap execution is pending a dedicated builder — add context message
	if (decision === COMPASS_DECISIONS.ALLOW) {
		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: swapResultData,
			approval: {
				required: evaluation.requiresApprovalCard,
				metadata: evaluation.requiresApprovalCard
					? evaluation.metadata
					: undefined,
			},
			message:
				"Compass allowed this swap evaluation. Swap execution is pending a dedicated execution builder.",
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL) {
		// Non-devnet with userConfirmedRisk: swap still can't execute,
		// so we add the external-approval context to the pending-builder message
		if (swapInput.network !== "devnet" && parsed.value.userConfirmedRisk) {
			swapResultData.externalApprovalRequired = true;
		}
		return buildRequireApprovalResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: swapResultData,
			approval: { required: true, metadata: evaluation.metadata },
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: swapResultData,
			auditId,
		});
	}

	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes,
		data: swapResultData,
		auditId,
	});
}

// ---------------------------------------------------------------------------
// Quote tool (read-only helper)
// ---------------------------------------------------------------------------

async function handleQuoteTool(
	registryEntry: CompassMcpToolRegistryEntry,
	classificationReasonCodes: string[],
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseQuoteInput(args);

	if (parsed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			metadata: { registeredTool: true, validationErrors: parsed.reasonCodes },
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: parsed.reasonCodes,
			auditId,
		});
	}

	try {
		const quote = await priceQuote.getUsdcSolQuote(parsed.value);
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.ALLOW,
			result: "success",
			network: quote.network,
			metadata: {
				registeredTool: true,
				quoteSource: quote.quote_source,
				provider: quote.provider,
			},
			params: summarizeQuoteParams(quote),
		});

		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: classificationReasonCodes,
			data: quote,
			auditId,
		});
	} catch (error) {
		const reasonCodes = [quoteErrorReasonCode(error)];
		const decision = isQuoteInputError(error)
			? COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT
			: COMPASS_DECISIONS.DENY;
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision,
			result: decision === COMPASS_DECISIONS.DENY ? "denied" : "failed",
			metadata: {
				registeredTool: true,
				errorCode: reasonCodes[0],
			},
		});

		if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
			return buildRequireAdditionalContextResult({
				toolName: registryEntry.name,
				riskClass: registryEntry.metadata.riskClass,
				reasonCodes,
				auditId,
			});
		}

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			auditId,
		});
	}
}

// ---------------------------------------------------------------------------
// Conditional oracle simulation (read-only helper)
// ---------------------------------------------------------------------------

function handleConditionalOracleSimulationTool(
	registryEntry: CompassMcpToolRegistryEntry,
	classificationReasonCodes: string[],
	args: Record<string, unknown> | undefined,
): CompassMcpToolResult {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseConditionalOracleSimulationInput(args);

	if (parsed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			metadata: { registeredTool: true, validationErrors: parsed.reasonCodes },
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: parsed.reasonCodes,
			message:
				"Compass requires valid oracle price, age, and confidence evidence.",
			auditId,
		});
	}

	const data = {
		...parsed.value,
		withinMaxAge:
			parsed.value.oracleAgeSeconds <= parsed.value.maxOracleAgeSeconds,
		withinMaxConfidence:
			parsed.value.oracleConfidenceBps <= parsed.value.maxConfidenceBps,
	};
	const auditId = emitMcpAudit({
		publicToolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification,
		decision: COMPASS_DECISIONS.ALLOW,
		result: "success",
		network: parsed.value.network,
		metadata: {
			registeredTool: true,
			withinMaxAge: data.withinMaxAge,
			withinMaxConfidence: data.withinMaxConfidence,
		},
		params: {
			oracleFeedPubkey: parsed.value.oracleFeedPubkey,
			oracleAgeSeconds: parsed.value.oracleAgeSeconds,
			oracleConfidenceBps: parsed.value.oracleConfidenceBps,
		},
	});

	return buildAllowResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes: classificationReasonCodes,
		data,
		auditId,
	});
}

// ---------------------------------------------------------------------------
// Input parsers
// ---------------------------------------------------------------------------

function parseCompassTransferInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: EvaluateTransferGatewayInput & { userConfirmedRisk?: boolean } }
	| { ok: false; reasonCodes: string[] } {
	if (!args) {
		return { ok: false, reasonCodes: ["INVALID_TRANSFER_INPUT"] };
	}

	const amountSol = args.amountSol;
	const recipientAddress = args.recipientAddress;

	if (
		typeof amountSol !== "number" ||
		!Number.isFinite(amountSol) ||
		amountSol <= 0 ||
		typeof recipientAddress !== "string" ||
		recipientAddress.trim().length === 0
	) {
		return { ok: false, reasonCodes: ["INVALID_TRANSFER_INPUT"] };
	}

	const network =
		typeof args.network === "string" && isMcpSupportedNetwork(args.network)
			? args.network
			: DEFAULT_NETWORK;
	const input: EvaluateTransferGatewayInput & { userConfirmedRisk?: boolean } = {
		network,
		amountSol,
		recipientAddress,
		quoteUsd: async () => {
			const quote = await priceQuote.getUsdcSolQuote({
				network,
				input_token: "SOL",
				output_token: "USDC",
				input_amount: amountSol,
			});

			return {
				amountUsd: quote.output_amount,
				source: quote.quote_source,
			};
		},
		userConfirmedRisk:
			typeof args.userConfirmedRisk === "boolean"
				? args.userConfirmedRisk
				: undefined,
	};

	if (typeof args.actorWallet === "string") {
		input.actorWallet = args.actorWallet;
	}

	input.recipientKnown = typeof args.recipientKnown === "boolean"
		? args.recipientKnown
		: false;

	if (isWalletSafetyEvidence(args.walletSafety)) {
		input.walletSafety = args.walletSafety;
	}

	return { ok: true, value: input };
}

function parseCompassSwapInput(
	args: Record<string, unknown> | undefined,
):
	| {
			ok: true;
			value: EvaluateSwapGatewayInput & { userConfirmedRisk?: boolean };
	  }
	| { ok: false; reasonCodes: string[] } {
	if (!args) {
		return { ok: false, reasonCodes: ["INVALID_SWAP_INPUT"] };
	}

	const inputToken = args.input_token;
	const outputToken = args.output_token;
	const inputAmount = args.input_amount;
	const slippageBps = args.slippage_bps;
	const protocol = args.protocol;
	const tokenKnown = args.token_known;
	const tokenMint = args.token_mint;

	if (
		typeof inputToken !== "string" ||
		inputToken.trim().length === 0 ||
		typeof outputToken !== "string" ||
		outputToken.trim().length === 0 ||
		typeof inputAmount !== "number" ||
		!Number.isFinite(inputAmount) ||
		inputAmount <= 0 ||
		typeof slippageBps !== "number" ||
		!Number.isFinite(slippageBps) ||
		slippageBps < 0 ||
		typeof protocol !== "string" ||
		protocol.trim().length === 0 ||
		typeof tokenKnown !== "boolean" ||
		typeof tokenMint !== "string" ||
		tokenMint.trim().length === 0
	) {
		return { ok: false, reasonCodes: ["INVALID_SWAP_INPUT"] };
	}

	const network =
		typeof args.network === "string" && isMcpSupportedNetwork(args.network)
			? args.network
			: DEFAULT_NETWORK;
	const normalizedInputToken = inputToken.toUpperCase();
	const normalizedOutputToken = outputToken.toUpperCase();

	if (
		!isSupportedSolUsdcSwapPair(normalizedInputToken, normalizedOutputToken)
	) {
		return { ok: false, reasonCodes: ["UNSUPPORTED_SWAP_PAIR"] };
	}

	const input: EvaluateSwapGatewayInput & { userConfirmedRisk?: boolean } = {
		network,
		inputToken: normalizedInputToken,
		outputToken: normalizedOutputToken,
		inputAmount,
		slippageBps,
		protocol,
		tokenKnown,
		tokenMint,
		quoteUsd: async () =>
			quoteSwapAmountUsd({
				network,
				inputToken: normalizedInputToken,
				outputToken: normalizedOutputToken,
				inputAmount,
				slippageBps,
			}),
		userConfirmedRisk:
			typeof args.userConfirmedRisk === "boolean"
				? args.userConfirmedRisk
				: undefined,
	};

	if (typeof args.actorWallet === "string") {
		input.actorWallet = args.actorWallet;
	}

	return { ok: true, value: input };
}

function parseQuoteInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: UsdcSolQuoteQuery }
	| { ok: false; reasonCodes: string[] } {
	if (!args) {
		return { ok: false, reasonCodes: ["INVALID_QUOTE_INPUT"] };
	}

	if (
		(args.input_token !== "USDC" && args.input_token !== "SOL") ||
		(args.output_token !== "USDC" && args.output_token !== "SOL") ||
		typeof args.input_amount !== "number" ||
		!Number.isFinite(args.input_amount) ||
		args.input_amount <= 0
	) {
		return { ok: false, reasonCodes: ["INVALID_QUOTE_INPUT"] };
	}

	const query: UsdcSolQuoteQuery = {
		input_token: args.input_token,
		output_token: args.output_token,
		input_amount: args.input_amount,
		network: typeof args.network === "string" ? args.network : DEFAULT_NETWORK,
	};

	if (typeof args.slippage_bps === "number") {
		query.slippage_bps = args.slippage_bps;
	}

	return { ok: true, value: query };
}

function summarizeQuoteParams(
	quote: Awaited<ReturnType<typeof priceQuote.getUsdcSolQuote>>,
) {
	return {
		network: quote.network,
		inputToken: quote.input_token,
		outputToken: quote.output_token,
		inputAmount: quote.input_amount,
		slippageBps: quote.slippage_bps,
	};
}

function parseConditionalOracleSimulationInput(
	args: Record<string, unknown> | undefined,
):
	| {
			ok: true;
			value: {
				network: string;
				oracleFeedPubkey: string;
				oraclePriceUsd: number;
				oracleAgeSeconds: number;
				maxOracleAgeSeconds: number;
				oracleConfidenceBps: number;
				maxConfidenceBps: number;
			};
	  }
	| { ok: false; reasonCodes: string[] } {
	if (!args) {
		return { ok: false, reasonCodes: ["INVALID_ORACLE_INPUT"] };
	}

	const oracleFeedPubkey = args.oracleFeedPubkey;
	const oraclePriceUsd = args.oraclePriceUsd;
	const oracleAgeSeconds = args.oracleAgeSeconds;
	const maxOracleAgeSeconds = args.maxOracleAgeSeconds;
	const oracleConfidenceBps = args.oracleConfidenceBps;
	const maxConfidenceBps = args.maxConfidenceBps;

	if (
		typeof oracleFeedPubkey !== "string" ||
		oracleFeedPubkey.trim().length === 0 ||
		!isPositiveNumber(oraclePriceUsd) ||
		!isNonNegativeNumber(oracleAgeSeconds) ||
		!isPositiveNumber(maxOracleAgeSeconds) ||
		!isNonNegativeNumber(oracleConfidenceBps) ||
		!isPositiveNumber(maxConfidenceBps)
	) {
		return { ok: false, reasonCodes: ["INVALID_ORACLE_INPUT"] };
	}

	return {
		ok: true,
		value: {
			network:
				typeof args.network === "string" ? args.network : DEFAULT_NETWORK,
			oracleFeedPubkey,
			oraclePriceUsd,
			oracleAgeSeconds,
			maxOracleAgeSeconds,
			oracleConfidenceBps,
			maxConfidenceBps,
		},
	};
}

function isSupportedSolUsdcSwapPair(
	inputToken: string,
	outputToken: string,
): boolean {
	return (
		(inputToken === "SOL" && outputToken === "USDC") ||
		(inputToken === "USDC" && outputToken === "SOL")
	);
}

async function quoteSwapAmountUsd(input: {
	network: string;
	inputToken: string;
	outputToken: string;
	inputAmount: number;
	slippageBps: number;
}) {
	if (input.inputToken === "USDC" && input.outputToken === "SOL") {
		return { amountUsd: input.inputAmount, source: "stable_usdc_input" };
	}

	if (input.inputToken !== "SOL" || input.outputToken !== "USDC") {
		return undefined;
	}

	const quote = await priceQuote.getUsdcSolQuote({
		network: input.network,
		input_token: "SOL",
		output_token: "USDC",
		input_amount: input.inputAmount,
		slippage_bps: input.slippageBps,
	});

	return { amountUsd: quote.output_amount, source: quote.quote_source };
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isWalletSafetyEvidence(
	value: unknown,
): value is EvaluateTransferGatewayInput["walletSafety"] {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

function emitMcpAudit(input: {
	publicToolName: string;
	actionKind: string;
	classification: ReturnType<typeof classifyToolCall>;
	decision: (typeof COMPASS_DECISIONS)[keyof typeof COMPASS_DECISIONS];
	result: "pending" | "success" | "failed" | "denied";
	metadata?: Record<string, unknown>;
	params?: Record<string, unknown>;
	network?: string;
}): string {
	const candidate = createActionCandidate({
		chain: "solana",
		network: input.network ?? DEFAULT_NETWORK,
		toolName: input.publicToolName,
		actionKind: `${MCP_AUDIT_ACTION_KIND_PREFIX}.${input.actionKind}`,
		params: input.params,
	});
	const event = buildAuditEvent({
		candidate,
		classification: {
			...input.classification,
			toolName: input.publicToolName,
		},
		decision: input.decision,
		result: input.result,
		metadata: input.metadata,
	});

	return recordMcpAuditEvent(event);
}

function quoteErrorReasonCode(error: unknown): string {
	const code = getErrorCode(error);
	return code ? `QUOTE_${code.toUpperCase()}` : "QUOTE_FAILED";
}

function isQuoteInputError(error: unknown): boolean {
	const code = getErrorCode(error);
	return Boolean(
		code &&
			[
				"invalid_quote_payload",
				"unsupported_network",
				"invalid_pair",
				"invalid_amount",
				"invalid_network_config",
			].includes(code),
	);
}

function getErrorCode(error: unknown): string | undefined {
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}