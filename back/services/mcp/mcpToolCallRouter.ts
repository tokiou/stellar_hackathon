import * as conditionalGateway from "../conditionalGateway";
import type { EvaluateConditionalGatewayInput } from "../conditionalGatewayContracts";
import { VersionedTransaction } from "@solana/web3.js";
import { defaultApprovalIdempotencyStore } from "../approvalIdempotencyStore";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";
import {
	buildAuditEvent,
	classifyToolCall,
	createActionCandidate,
} from "../executionGateway";
import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import {
	type LlmJudgeConfig,
	type LlmClampedDecision,
} from "../llmDecisionContracts";
import {
	evaluateLlmMetadata,
	resolveLlmConfig,
} from "../llmDecisionAdapter";
import { sanitizeLlmJudgeInput } from "../llmDecisionSanitizer";
import * as onchainApproval from "../onchainApproval";
import type { OnchainActionApprovalProof } from "../onchainApproval";
import * as priceQuote from "../priceQuote";
import type { UsdcSolQuoteQuery } from "../priceQuote";
import { createSignerAdapter } from "../signerAdapter";
import * as swapGateway from "../swapGateway";
import type { EvaluateSwapGatewayInput } from "../swapGatewayContracts";
import * as transferGateway from "../transferGateway";
import type { EvaluateTransferGatewayInput } from "../transferGatewayContracts";
import { buildSolTransferTransactionPayload } from "../transferTransactionPayload";
import { recordMcpAuditEvent } from "./mcpAuditSink";
import {
	MCP_TOOL_NAMES,
	type CompassMcpToolCallInput,
	type CompassMcpToolRegistryEntry,
	type CompassMcpToolResult,
	type ExecuteApprovedActionInput,
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
 * Optional LLM metadata enrichment after deterministic evaluation.
 *
 * If LLM config is missing/disabled, returns the deterministic result unchanged.
 * If enabled, calls the LLM judge and clamps the result so deterministic DENY
 * cannot be loosened. Audit metadata is always attached when LLM is consulted.
 */
async function enrichWithLlmMetadata(
	deterministicDecision: typeof COMPASS_DECISIONS[keyof typeof COMPASS_DECISIONS],
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
	deterministicDecision: typeof COMPASS_DECISIONS[keyof typeof COMPASS_DECISIONS],
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

type McpSupportedNetwork = (typeof MCP_SUPPORTED_NETWORKS)[number];

export async function handleMcpToolCall(
	input: CompassMcpToolCallInput,
): Promise<CompassMcpToolResult> {
	const registryEntry = getMcpTool(input.toolName);
	const classification = classifyToolCall({
		toolName: registryEntry?.classificationToolName ?? input.toolName,
		mutates: registryEntry?.mutates ?? input.mutates,
	});

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

	if (registryEntry.name === MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION) {
		return denyRegisteredTool(registryEntry, classification.reasonCodes);
	}

	if (registryEntry.name === MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION) {
		return handleExecuteApprovedActionTool(registryEntry, input.arguments);
	}

	if (classification.defaultDecision === COMPASS_DECISIONS.DENY) {
		return denyRegisteredTool(registryEntry, classification.reasonCodes);
	}

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
		case MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL:
			return handleTransferTool(registryEntry, input.arguments);
		case MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC:
			return handleSwapTool(registryEntry, input.arguments);
		case MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL:
			return handleConditionalTool(registryEntry, input.arguments);
	}
}

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
			"Compass blocks direct sign_and_send_transaction. Route actions through guarded_transfer_sol, guarded_swap_sol_usdc, or create_conditional_buy_sol, then call execute_approved_action with the gateway candidate ID.",
		auditId,
	});
}

async function handleExecuteApprovedActionTool(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseExecuteApprovedActionInput(args);

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
				duplicateBlocked: false,
				signerPath: "not_reached",
			},
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: parsed.reasonCodes,
			message: "Compass requires a valid gateway candidate ID to execute an approved action.",
			auditId,
		});
	}

	const proofBinding = validateApprovalProofBinding(parsed.value);
	if (proofBinding.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: proofBinding.decision,
			result: proofBinding.decision === COMPASS_DECISIONS.DENY ? "denied" : "failed",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: false,
				approvalVerified: false,
				signerPath: "not_reached",
				validationErrors: proofBinding.reasonCodes,
			},
		});

		if (proofBinding.decision === COMPASS_DECISIONS.DENY) {
			return buildDenyResult({
				toolName: registryEntry.name,
				riskClass: registryEntry.metadata.riskClass,
				reasonCodes: proofBinding.reasonCodes,
				message: "Compass blocked execution because the approval proof does not match the transaction payload.",
				data: {
					candidateId: parsed.value.candidateId,
					signerPath: "not_reached",
				},
				auditId,
			});
		}

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: proofBinding.reasonCodes,
			message: "Compass requires a complete approval proof with action hash and user before execution.",
			auditId,
		});
	}

	let devnetApprovalBypassed = false;
	if (parsed.value.approvalProof) {
		const approval = await onchainApproval.verifyActionApproval(
			parsed.value.approvalProof,
		);
		if (!approval.ok) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: false,
				approvalVerified: false,
				devnetApprovalBypassed: false,
				signerPath: "not_reached",
			},
		});

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: [approval.reason ?? "ONCHAIN_ACTION_APPROVAL_INVALID"],
			message: "Compass blocked execution because on-chain approval proof verification failed.",
			data: {
				candidateId: parsed.value.candidateId,
				signerPath: "not_reached",
			},
			auditId,
		});
		}
	} else {
		// Devnet approval bypass: must match a transaction payload that Compass
		// itself built in a prior guarded_transfer_sol / guarded_swap_sol_usdc /
		// create_conditional_buy_sol call. Arbitrary caller-provided payloads are
		// denied to prevent signing unvetted transactions.
		const devnetPayloadGuard = validateDevnetBypassPayload(parsed.value);
		if (devnetPayloadGuard.ok === false) {
			const { reason: devnetDenyReason } = devnetPayloadGuard;
			const auditId = emitMcpAudit({
				publicToolName: registryEntry.name,
				actionKind: registryEntry.actionKind,
				classification,
				decision: COMPASS_DECISIONS.DENY,
				result: "denied",
				network: parsed.value.network,
				metadata: {
					registeredTool: true,
					candidateId: parsed.value.candidateId,
					duplicateBlocked: false,
					approvalVerified: false,
					devnetApprovalBypassed: false,
					devnetPayloadGuardReason: devnetDenyReason,
					signerPath: "not_reached",
				},
			});

			return buildDenyResult({
				toolName: registryEntry.name,
				riskClass: registryEntry.metadata.riskClass,
				reasonCodes: [devnetDenyReason],
				message: "Compass blocked devnet execution because the transaction payload was not built by Compass. Only payloads from guarded_transfer_sol (or equivalent Compass-guarded calls) may execute without on-chain approval proof.",
				data: {
					candidateId: parsed.value.candidateId,
					signerPath: "not_reached",
				},
				auditId,
			});
		}
		devnetApprovalBypassed = true;
	}
	let unsignedTx: VersionedTransaction;
	try {
		unsignedTx = VersionedTransaction.deserialize(
			Buffer.from(
				parsed.value.transactionPayload.unsignedVersionedTransaction,
				"base64",
			),
		);
	} catch {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
				validationErrors: ["INVALID_TRANSACTION_PAYLOAD"],
			},
		});

		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: ["INVALID_TRANSACTION_PAYLOAD"],
			message: "Compass requires a valid unsigned VersionedTransaction payload to execute this approved action.",
			auditId,
		});
	}

	const signer = createSignerAdapter({ rpcUrl: networkToRpcUrl(parsed.value.network) });
	if (signer.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
			},
		});

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: [signer.reason],
			message: "Compass cannot execute this approved action because no local devnet signer is configured.",
			data: {
				candidateId: parsed.value.candidateId,
				signerPath: "not_reached",
			},
			auditId,
		});
	}

	if (!signer.adapter.signAndSendTransaction) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
			},
		});

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: ["LOCAL_SIGNER_NOT_CONFIGURED"],
			message: "Compass cannot execute this approved action because the configured signer cannot submit transactions.",
			data: {
				candidateId: parsed.value.candidateId,
				signerPath: "not_reached",
			},
			auditId,
		});
	}

	const consumed = defaultApprovalIdempotencyStore.consume(
		parsed.value.candidateId,
	);
	if (consumed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: registryEntry.name,
			actionKind: registryEntry.actionKind,
			classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: parsed.value.network,
			metadata: {
				registeredTool: true,
				candidateId: parsed.value.candidateId,
				duplicateBlocked: true,
				approvalVerified: true,
				signerPath: "not_reached",
			},
		});

		return buildDenyResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes: [consumed.reason],
			message: "Compass blocked duplicate execution for this approved action candidate.",
			data: {
				candidateId: parsed.value.candidateId,
				signerPath: "not_reached",
			},
			auditId,
		});
	}

	const signature = await signer.adapter.signAndSendTransaction(unsignedTx);
	const auditId = emitMcpAudit({
		publicToolName: registryEntry.name,
		actionKind: registryEntry.actionKind,
		classification,
		decision: COMPASS_DECISIONS.ALLOW,
		result: "success",
		network: parsed.value.network,
		metadata: {
			registeredTool: true,
			candidateId: parsed.value.candidateId,
			duplicateBlocked: false,
			approvalVerified: true,
			devnetApprovalBypassed,
			signerPath: "local_keypair",
			transactionSubmitted: true,
			signature,
		},
	});

	return buildAllowResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes: classification.reasonCodes,
		message: "Compass approved this action for the local devnet signer boundary.",
		data: {
			candidateId: parsed.value.candidateId,
			signerPath: "local_keypair",
			signature,
		},
		auditId,
	});
}

function parseExecuteApprovedActionInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: ExecuteApprovedActionInput & { network: McpSupportedNetwork } }
	| { ok: false; reasonCodes: string[] } {
	if (!args || typeof args.candidateId !== "string") {
		return {
			ok: false,
			reasonCodes: ["INVALID_EXECUTE_APPROVED_ACTION_INPUT"],
		};
	}

	const candidateId = args.candidateId.trim();
	if (candidateId.length === 0) {
		return {
			ok: false,
			reasonCodes: ["INVALID_EXECUTE_APPROVED_ACTION_INPUT"],
		};
	}

	const network =
		typeof args.network === "string" && isMcpSupportedNetwork(args.network)
			? args.network
			: DEFAULT_NETWORK;

	if (!isOnchainActionApprovalProof(args.approvalProof) && network !== "devnet") {
		return {
			ok: false,
			reasonCodes: ["MISSING_APPROVAL_PROOF"],
		};
	}

	if (!isValidExecuteTransactionPayload(args.transactionPayload)) {
		return {
			ok: false,
			reasonCodes: ["MISSING_TRANSACTION_PAYLOAD"],
		};
	}

	return {
		ok: true,
		value: {
			candidateId,
			network,
			approvalProof: isOnchainActionApprovalProof(args.approvalProof)
				? args.approvalProof
				: undefined,
			transactionPayload: args.transactionPayload,
		},
	};
}

function isMcpSupportedNetwork(value: string): value is McpSupportedNetwork {
	return MCP_SUPPORTED_NETWORKS.includes(value as McpSupportedNetwork);
}

async function applyDefaultActorWallet<T extends { actorWallet?: string; network: string }>(
	input: T,
): Promise<T> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOnchainActionApprovalProof(
	value: unknown,
): value is OnchainActionApprovalProof {
	return isRecord(value) && typeof value.execute_tx_signature === "string";
}

function validateApprovalProofBinding(
	input: ExecuteApprovedActionInput & { network: McpSupportedNetwork },
):
	| { ok: true }
	| { ok: false; decision: typeof COMPASS_DECISIONS.DENY | typeof COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT; reasonCodes: string[] } {
	if (!input.approvalProof && input.network === "devnet") {
		return { ok: true };
	}

	const proofActionHash = normalizeActionHash(input.approvalProof?.action_hash);
	const payloadActionHash = normalizeActionHash(input.transactionPayload.actionHash);

	if (!proofActionHash || !input.approvalProof?.user) {
		return {
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			reasonCodes: ["INCOMPLETE_APPROVAL_PROOF"],
		};
	}

	if (!payloadActionHash) {
		return {
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			reasonCodes: ["INVALID_TRANSACTION_ACTION_HASH"],
		};
	}

	if (proofActionHash !== payloadActionHash) {
		return {
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			reasonCodes: ["APPROVAL_TRANSACTION_ACTION_HASH_MISMATCH"],
		};
	}

	return { ok: true };
}

function normalizeActionHash(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

function isValidExecuteTransactionPayload(
	value: unknown,
): value is ExecuteApprovedActionInput["transactionPayload"] {
	return (
		isRecord(value) &&
		value.encoding === "base64" &&
		typeof value.actionHash === "string" &&
		value.actionHash.trim().length > 0 &&
		typeof value.unsignedVersionedTransaction === "string" &&
		value.unsignedVersionedTransaction.trim().length > 0
	);
}

/**
 * Validate that a devnet approval-bypass payload matches a transaction
 * built by Compass in a prior guarded call. Without this check, any MCP
 * client could supply an arbitrary unsigned transaction for Compass to sign.
 */
function validateDevnetBypassPayload(
	input: ExecuteApprovedActionInput & { network: McpSupportedNetwork },
): { ok: true } | { ok: false; reason: string } {
	if (input.network !== "devnet") {
		return {
			ok: false,
			reason: "DEVNET_APPROVAL_BYPASS_NETWORK_NOT_DEVNET",
		};
	}

	const payloadActionHash = normalizeActionHash(input.transactionPayload.actionHash);

	// Try candidateId lookup first (primary key), then actionHash (secondary).
	const stored = payloadActionHash
		? defaultPendingTransactionStore.consumeByCandidateId(input.candidateId) ??
			defaultPendingTransactionStore.consumeByActionHash(payloadActionHash)
		: defaultPendingTransactionStore.consumeByCandidateId(input.candidateId);

	if (!stored) {
		return {
			ok: false,
			reason: "DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE",
		};
	}

	// Network must match.
	if (stored.network !== input.network) {
		return {
			ok: false,
			reason: "DEVNET_APPROVAL_BYPASS_NETWORK_MISMATCH",
		};
	}

	// The unsigned transaction bytes must match exactly.
	if (
		stored.unsignedVersionedTransaction !==
		input.transactionPayload.unsignedVersionedTransaction
	) {
		return {
			ok: false,
			reason: "DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_COMPASS_BUILT",
		};
	}

	return { ok: true };
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

async function handleTransferTool(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseTransferInput(args);

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
	const evaluation = await transferGateway.evaluateTransferGateway({
		...transferInput,
		toolName: registryEntry.classificationToolName,
	});
	const deterministicDecision = evaluation.policyEvaluation.decision;
	const reasonCodes = evaluation.policyEvaluation.reasonCodes;

	// Optional LLM metadata enrichment - never loosens deterministic decisions.
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
	const transferResultData = await buildTransferResultData({
		evaluation,
		input: transferInput,
		includeExecutionPayload:
			decision === COMPASS_DECISIONS.ALLOW ||
			decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
	});

	if (decision === COMPASS_DECISIONS.ALLOW) {
		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: transferResultData,
			approval: {
				required: evaluation.requiresApprovalCard,
				metadata: evaluation.requiresApprovalCard
					? evaluation.metadata
					: undefined,
			},
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL) {
		return buildRequireApprovalResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: transferResultData,
			approval: {
				required: true,
				metadata: evaluation.metadata,
			},
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: transferResultData,
			auditId,
		});
	}

	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes,
		data: transferResultData,
		auditId,
	});
}

async function handleSwapTool(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseSwapInput(args);

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
	const evaluation = await swapGateway.evaluateSwapGateway({
		...swapInput,
		toolName: registryEntry.classificationToolName,
	});
	const deterministicDecision = evaluation.policyEvaluation.decision;
	const reasonCodes = evaluation.policyEvaluation.reasonCodes;

	// Optional LLM metadata enrichment - never loosens deterministic decisions.
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

	if (decision === COMPASS_DECISIONS.ALLOW) {
		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildSwapResultData(evaluation),
			approval: {
				required: evaluation.requiresApprovalCard,
				metadata: evaluation.requiresApprovalCard
					? evaluation.metadata
					: undefined,
			},
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL) {
		return buildRequireApprovalResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildSwapResultData(evaluation),
			approval: { required: true, metadata: evaluation.metadata },
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildSwapResultData(evaluation),
			auditId,
		});
	}

	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes,
		data: buildSwapResultData(evaluation),
		auditId,
	});
}

async function handleConditionalTool(
	registryEntry: CompassMcpToolRegistryEntry,
	args: Record<string, unknown> | undefined,
): Promise<CompassMcpToolResult> {
	const classification = classifyToolCall({
		toolName: registryEntry.classificationToolName,
		mutates: registryEntry.mutates,
	});
	const parsed = parseConditionalInput(args);

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
				"Compass requires valid conditional amount, target, oracle, expiry, and slippage context.",
			auditId,
		});
	}

	const conditionalInput = await applyDefaultActorWallet(parsed.value);
	const evaluation = await conditionalGateway.evaluateConditionalGateway({
		...conditionalInput,
		toolName: registryEntry.classificationToolName,
	});
	const deterministicDecision = evaluation.policyEvaluation.decision;
	const reasonCodes = evaluation.policyEvaluation.reasonCodes;

	// Optional LLM metadata enrichment - never loosens deterministic decisions.
	const { llmMetadata } = await enrichWithLlmMetadata(
		deterministicDecision,
		evaluation.classification.riskClass,
		evaluation.classification,
		registryEntry,
		conditionalInput.network,
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
			network: conditionalInput.network,
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
			conditionSummary: {
				targetPriceUsd: parsed.value.targetPriceUsd,
				expiresAtUnix: parsed.value.expiresAtUnix,
			},
			oracleSummary: {
				oracleFeedPubkey: parsed.value.oracleFeedPubkey,
				oracleAgeSeconds: parsed.value.oracleAgeSeconds,
				oracleConfidenceBps: parsed.value.oracleConfidenceBps,
			},
			...(llmMetadata?.llmConsulted
				? {
						llmConsulted: true,
						llmDecision: llmMetadata.decision,
						llmClamped: llmMetadata.clamped,
					}
				: {}),
		},
		params: {
			inputAmountUsdc: parsed.value.inputAmountUsdc,
			targetPriceUsd: parsed.value.targetPriceUsd,
			maxSlippageBps: parsed.value.maxSlippageBps,
			oracleFeedPubkey: parsed.value.oracleFeedPubkey,
			recipient: parsed.value.recipient,
			expiresAtUnix: parsed.value.expiresAtUnix,
		},
	});

	if (decision === COMPASS_DECISIONS.ALLOW) {
		return buildAllowResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildConditionalResultData(evaluation),
			approval: {
				required: evaluation.requiresApprovalCard,
				metadata: evaluation.requiresApprovalCard
					? evaluation.metadata
					: undefined,
			},
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL) {
		return buildRequireApprovalResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildConditionalResultData(evaluation),
			approval: { required: true, metadata: evaluation.metadata },
			auditId,
		});
	}

	if (decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT) {
		return buildRequireAdditionalContextResult({
			toolName: registryEntry.name,
			riskClass: registryEntry.metadata.riskClass,
			reasonCodes,
			data: buildConditionalResultData(evaluation),
			auditId,
		});
	}

	return buildDenyResult({
		toolName: registryEntry.name,
		riskClass: registryEntry.metadata.riskClass,
		reasonCodes,
		data: buildConditionalResultData(evaluation),
		auditId,
	});
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

function parseTransferInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: EvaluateTransferGatewayInput }
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
		typeof args.network === "string" ? args.network : DEFAULT_NETWORK;
	const input: EvaluateTransferGatewayInput = {
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

function parseSwapInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: EvaluateSwapGatewayInput }
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
		typeof args.network === "string" ? args.network : DEFAULT_NETWORK;
	const normalizedInputToken = inputToken.toUpperCase();
	const normalizedOutputToken = outputToken.toUpperCase();

	if (
		!isSupportedSolUsdcSwapPair(normalizedInputToken, normalizedOutputToken)
	) {
		return { ok: false, reasonCodes: ["UNSUPPORTED_SWAP_PAIR"] };
	}

	const input: EvaluateSwapGatewayInput = {
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
	};

	if (typeof args.actorWallet === "string") {
		input.actorWallet = args.actorWallet;
	}

	return { ok: true, value: input };
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

function parseConditionalInput(
	args: Record<string, unknown> | undefined,
):
	| { ok: true; value: EvaluateConditionalGatewayInput }
	| { ok: false; reasonCodes: string[] } {
	if (!args) {
		return { ok: false, reasonCodes: ["INVALID_CONDITIONAL_INPUT"] };
	}

	const inputAmountUsdc = args.inputAmountUsdc;
	const targetPriceUsd = args.targetPriceUsd;
	const maxSlippageBps = args.maxSlippageBps;
	const oracleFeedPubkey = args.oracleFeedPubkey;
	const oraclePriceUsd = args.oraclePriceUsd;
	const oracleAgeSeconds = args.oracleAgeSeconds;
	const maxOracleAgeSeconds = args.maxOracleAgeSeconds;
	const oracleConfidenceBps = args.oracleConfidenceBps;
	const maxConfidenceBps = args.maxConfidenceBps;
	const recipient = args.recipient;
	const expiresAtUnix = args.expiresAtUnix;

	if (
		!isPositiveNumber(inputAmountUsdc) ||
		!isPositiveNumber(targetPriceUsd) ||
		!isNonNegativeNumber(maxSlippageBps) ||
		typeof oracleFeedPubkey !== "string" ||
		oracleFeedPubkey.trim().length === 0 ||
		!isPositiveNumber(oraclePriceUsd) ||
		!isNonNegativeNumber(oracleAgeSeconds) ||
		!isPositiveNumber(maxOracleAgeSeconds) ||
		!isNonNegativeNumber(oracleConfidenceBps) ||
		!isPositiveNumber(maxConfidenceBps) ||
		typeof recipient !== "string" ||
		recipient.trim().length === 0 ||
		!isPositiveNumber(expiresAtUnix)
	) {
		return { ok: false, reasonCodes: ["INVALID_CONDITIONAL_INPUT"] };
	}

	const input: EvaluateConditionalGatewayInput = {
		network: typeof args.network === "string" ? args.network : DEFAULT_NETWORK,
		inputToken: "USDC",
		inputAmountUsdc,
		targetPriceUsd,
		maxSlippageBps,
		oracleFeedPubkey,
		oraclePriceUsd,
		oracleAgeSeconds,
		maxOracleAgeSeconds,
		oracleConfidenceBps,
		maxConfidenceBps,
		recipient,
		expiresAtUnix,
	};

	if (typeof args.actorWallet === "string") {
		input.actorWallet = args.actorWallet;
	}

	if (isNonNegativeNumber(args.desiredSolLamports)) {
		input.desiredSolLamports = args.desiredSolLamports;
	}

	if (isPositiveNumber(args.currentUnixTimestamp)) {
		input.currentUnixTimestamp = args.currentUnixTimestamp;
	}

	return { ok: true, value: input };
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

async function buildTransferResultData(input: {
	evaluation: Awaited<
		ReturnType<typeof transferGateway.evaluateTransferGateway>
	>;
	input: EvaluateTransferGatewayInput;
	includeExecutionPayload: boolean;
}): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {
		proposalEligible: input.evaluation.proposalEligible,
		requiresApprovalCard: input.evaluation.requiresApprovalCard,
		failClosedReason: input.evaluation.failClosedReason,
		policyId: input.evaluation.policyEvaluation.policyId,
	};

	if (!input.includeExecutionPayload || !input.input.actorWallet) {
		return result;
	}

	const transferPayload = await buildSolTransferTransactionPayload({
		candidateId: input.evaluation.metadata.candidateId,
		network: input.input.network,
		sourceWallet: input.input.actorWallet,
		recipientAddress: input.input.recipientAddress,
		amountSol: input.input.amountSol,
		rpcUrl: networkToRpcUrl(input.input.network),
	});

	if (transferPayload.ok === false) {
		return {
			...result,
			executionPayloadStatus: "unavailable",
			executionPayloadReason: transferPayload.reason,
		};
	}

	// Record the payload in the pending store so execute_approved_action can
	// verify that a devnet approval-bypass payload was actually built by Compass.
	defaultPendingTransactionStore.record({
		candidateId: input.evaluation.metadata.candidateId,
		actionHash: transferPayload.payload.actionHash,
		unsignedVersionedTransaction:
			transferPayload.payload.unsignedVersionedTransaction,
		network: input.input.network,
		tool: "guarded_transfer_sol",
		action: "transfer",
	});

	return {
		...result,
		executionPayloadStatus: "ready",
		transactionPayload: transferPayload.payload,
		executionPayload: transferPayload.payload,
		sourceWallet: transferPayload.sourceWallet,
		recipientAddress: transferPayload.recipientAddress,
		lamports: transferPayload.lamports,
	};
}

function buildSwapResultData(
	evaluation: Awaited<ReturnType<typeof swapGateway.evaluateSwapGateway>>,
): Record<string, unknown> {
	return {
		proposalEligible: evaluation.proposalEligible,
		requiresApprovalCard: evaluation.requiresApprovalCard,
		failClosedReason: evaluation.failClosedReason,
		policyId: evaluation.policyEvaluation.policyId,
	};
}

function buildConditionalResultData(
	evaluation: Awaited<
		ReturnType<typeof conditionalGateway.evaluateConditionalGateway>
	>,
): Record<string, unknown> {
	return {
		proposalEligible: evaluation.proposalEligible,
		requiresApprovalCard: evaluation.requiresApprovalCard,
		failClosedReason: evaluation.failClosedReason,
		policyId: evaluation.policyEvaluation.policyId,
	};
}

function emitMcpAudit(input: {
	publicToolName: string;
	actionKind: string;
	classification: ReturnType<typeof classifyToolCall>;
	decision: ReturnType<typeof classifyToolCall>["defaultDecision"];
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

function isWalletSafetyEvidence(
	value: unknown,
): value is EvaluateTransferGatewayInput["walletSafety"] {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
