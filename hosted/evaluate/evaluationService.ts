import {
	classifyToolCall,
	createActionCandidate,
} from "@back/guardrail/execution/executionGateway";
import { getPostHogClient, getInstallationDistinctId } from "@back/posthog/posthogClient";
import { resolveChainConfig } from "@back/services/chain/chainConfig";
import { COMPASS_DECISIONS } from "@shared/executionGatewayContracts";
import {
	callLlmJudge,
	clampLlmDecision,
	resolveLlmConfig,
} from "../llm/llmDecisionAdapter";
import {
	resolveRouterConfig,
	routeToolCall,
} from "../llm/llmRouterAdapter";
import { sanitizeLlmJudgeInput } from "../llm/llmDecisionSanitizer";
import { evaluateAction as evaluatePolicyAction } from "../policy/policyEngine";
import { loadDefaultPolicy } from "../policy/loadPolicy";
import type {
	PolicyEvaluation,
	PolicyEvaluationContext,
} from "@shared/policyContracts";
import type { AuditWriteRequest } from "../audit/auditContracts";
import {
	HOSTED_RISK_LEVELS,
	type EvaluateActionRequest,
	type EvaluateActionResponse,
	type EvaluationService,
	type EvaluationServiceDependencies,
	type HostedRiskLevel,
} from "./evaluationContracts";

// ── Hosted debug logger (writes to shared compass-debug.log) ──
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function getLogFile(): string {
	return join(process.cwd(), "logs", "compass-debug.log");
}

function hostedDebug(module: string, fn: string, message: string, data?: Record<string, unknown>) {
	const raw = process.env["COMPASS_DEBUG"];
	if (!raw || raw.trim() === "" || raw.trim() === "0") return;
	const tokens = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	if (!tokens.some((t) => t === "true" || t === "1" || t === "*") && !tokens.includes(module.toLowerCase())) return;

	const dir = join(process.cwd(), "logs");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const timestamp = new Date().toISOString();
	const dataStr = data ? ` ${JSON.stringify(data)}` : "";
	appendFileSync(getLogFile(), `[${timestamp}] [${module}:${fn}] ${message}${dataStr}\n`, "utf-8");
}

const AUDIT_DEGRADED_RESPONSE: EvaluateActionResponse = {
	correlationId: "audit-unavailable",
	decision: "deny",
	riskLevel: HOSTED_RISK_LEVELS.HIGH,
	reasons: ["AUDIT_DEGRADED_DENIAL"],
	suggestedAction: "Restore hosted audit persistence before retrying.",
	auditRef: "audit-unavailable",
};

export type { EvaluationServiceDependencies } from "./evaluationContracts";

export function createEvaluationService(
	deps: Partial<EvaluationServiceDependencies> = {},
): EvaluationService {
	const resolvedDeps: EvaluationServiceDependencies = {
		routeToolCall,
		callLlmJudge,
		loadPolicy: loadDefaultPolicy,
		evaluatePolicy: evaluatePolicyAction,
		writeAudit: async () => {
			throw new Error("Audit store not configured.");
		},
		...deps,
	};

	return {
		async evaluateAction(request: EvaluateActionRequest): Promise<EvaluateActionResponse> {
			const t0 = Date.now();
			hostedDebug("hosted", "evaluateAction", "Incoming request", {
				toolName: request.toolName,
				correlationId: request.correlationId,
				arguments: request.arguments,
			});

			const routerResult = await resolvedDeps.routeToolCall(
				{
					toolName: request.toolName,
					toolParams: request.arguments,
				},
				resolveRouterConfig(),
			);

			hostedDebug("hosted", "evaluateAction", "Router result", {
				toolName: request.toolName,
				classification: routerResult.classification,
				reasoning: routerResult.reasoning,
			});

			const preliminaryResponse = await buildDecisionResponse({
				request,
				routerResult,
				deps: resolvedDeps,
			});

			let finalResponse: EvaluateActionResponse;
			try {
				const auditWrite = await resolvedDeps.writeAudit(
					buildAuditWriteRequest(request, preliminaryResponse),
				);

				finalResponse = {
					...preliminaryResponse,
					correlationId: auditWrite.correlationId,
					auditRef: auditWrite.auditRef,
				};
			} catch {
				getPostHogClient().captureException(
					new Error("Audit write failed; returning degraded denial."),
					request.userId ?? getInstallationDistinctId(),
					{ tool_name: request.toolName, event_context: "hosted_action_evaluated_audit_degraded" },
				);

				return {
					...AUDIT_DEGRADED_RESPONSE,
					correlationId: request.correlationId,
				};
			}

			try {
				getPostHogClient().capture({
					distinctId: request.userId ?? getInstallationDistinctId(),
					event: "hosted_action_evaluated",
					properties: {
						tool_name: request.toolName,
						decision: finalResponse.decision,
						risk_level: finalResponse.riskLevel,
						reasons: finalResponse.reasons,
						correlation_id: finalResponse.correlationId,
						session_id: request.sessionId,
					},
				});
			} catch {
				// ponytail: telemetry failure must not block evaluation
			}

			hostedDebug("hosted", "evaluateAction", "Completed", {
				toolName: request.toolName,
				decision: finalResponse.decision,
				riskLevel: finalResponse.riskLevel,
				elapsedMs: Date.now() - t0,
			});

			return finalResponse;
		},
	};
}

async function buildDecisionResponse(input: {
	request: EvaluateActionRequest;
	routerResult: Awaited<ReturnType<typeof routeToolCall>>;
	deps: EvaluationServiceDependencies;
}): Promise<EvaluateActionResponse> {
	const { request, routerResult, deps } = input;
	const t0 = Date.now();
	const chainConfig = resolveChainConfig();

	if (routerResult.classification === "skip") {
		return {
			correlationId: request.correlationId,
			decision: "allow",
			riskLevel: HOSTED_RISK_LEVELS.LOW,
			reasons: ["ROUTER_SKIP_ALLOW"],
			auditRef: "pending-audit",
		};
	}

	if (routerResult.classification === "unknown") {
		// unknown → LLM judge decides (fail-closed only if LLM is unavailable)
		const llmInput = sanitizeLlmJudgeInput({
			toolName: request.toolName,
			actionKind: "unknown",
			network: chainConfig.network,
			deterministicDecision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			riskClass: "unknown",
			reasonCodes: ["ROUTER_UNKNOWN"],
			rawContext: request.arguments,
			userIntent: request.agentContext?.userIntent,
		});

		hostedDebug("hosted", "llmJudge", "Sending to LLM judge (unknown tool)", {
			toolName: request.toolName,
			llmInput,
		});

		const llmDecision = await deps.callLlmJudge(llmInput, resolveLlmConfig());

		hostedDebug("hosted", "llmJudge", "LLM judge response", {
			toolName: request.toolName,
			llmRaw: llmDecision,
		});

		const decision = llmDecision?.decision === "ALLOW"
			? "allow"
			: llmDecision?.decision === "DENY"
				? "deny"
				: "confirm";

		return {
			correlationId: request.correlationId,
			decision,
			riskLevel: decision === "allow" ? HOSTED_RISK_LEVELS.LOW : HOSTED_RISK_LEVELS.MEDIUM,
			reasons: [
				"ROUTER_UNKNOWN",
				...(llmDecision?.reasonCodes ?? []),
			],
			suggestedAction: decision === "confirm"
				? "LLM judge could not classify with certainty; request user confirmation."
				: undefined,
			auditRef: "pending-audit",
		};
	}

	const policy = deps.loadPolicy();
	const classification = classifyToolCall({
		toolName: request.toolName,
		mutates: true,
	});
	const candidate = createActionCandidate({
		id: request.correlationId,
		chain: chainConfig.chain,
		network: chainConfig.network,
		toolName: request.toolName,
		actionKind: routerResult.classification,
		createdAt: request.requestedAt,
		params: request.arguments,
		evidence: {
			localFindings: request.localFindings,
			routerReasoning: routerResult.reasoning,
		},
	});
	const policyEvaluation = deps.evaluatePolicy({
		candidate,
		classification,
		context: derivePolicyContext(routerResult.classification, request.arguments),
		policy,
	});

	hostedDebug("hosted", "policy", "Policy evaluation", {
		toolName: request.toolName,
		decision: policyEvaluation.decision,
		reasonCodes: policyEvaluation.reasonCodes,
		policyId: policyEvaluation.policyId,
	});

	const llmInput2 = sanitizeLlmJudgeInput({
		toolName: request.toolName,
		actionKind: routerResult.classification,
		network: chainConfig.network,
		deterministicDecision: policyEvaluation.decision,
		riskClass: classification.riskClass,
		reasonCodes: policyEvaluation.reasonCodes,
		policyId: policyEvaluation.policyId,
		evaluatedRules: policyEvaluation.evaluatedRules,
		rawContext: request.arguments,
		userIntent: request.agentContext?.userIntent,
	});

	hostedDebug("hosted", "llmJudge", "Sending to LLM judge (known tool)", {
		toolName: request.toolName,
		llmInput: llmInput2,
	});

	const llmDecision = await deps.callLlmJudge(llmInput2, resolveLlmConfig());

	hostedDebug("hosted", "llmJudge", "LLM judge response", {
		toolName: request.toolName,
		llmRaw: llmDecision,
	});

	const clampedDecision = clampLlmDecision(policyEvaluation.decision, llmDecision);
	const reasons = [
		...policyEvaluation.reasonCodes,
		...(clampedDecision.llmReasonCodes ?? []),
	];

	return {
		correlationId: request.correlationId,
		decision: mapHostedDecision(clampedDecision.decision),
		riskLevel: mapRiskLevel(clampedDecision.decision),
		reasons,
		suggestedAction: buildSuggestedAction(clampedDecision.decision),
		auditRef: "pending-audit",
	};
}

function derivePolicyContext(
	actionKind: "transfer" | "swap",
	argumentsValue: Record<string, unknown> | undefined,
): PolicyEvaluationContext {
	const args = argumentsValue ?? {};

	if (actionKind === "transfer") {
		return {
			amount_usd: readNumber(args, ["amountUsd", "amount_usd", "usdAmount"]),
			recipient_address: readString(args, [
				"recipient",
				"recipientAddress",
				"destination",
				"address",
			]),
			recipient_known: readBoolean(args, ["recipientKnown", "recipient_known"]),
			flags: {
				suspicious_recipient: readBoolean(args, [
					"suspiciousRecipient",
					"suspicious_recipient",
				]),
				unknown_program: readBoolean(args, ["unknownProgram", "unknown_program"]),
				unlimited_delegate: readBoolean(args, [
					"unlimitedDelegate",
					"unlimited_delegate",
				]),
				authority_change: readBoolean(args, [
					"authorityChange",
					"authority_change",
				]),
			},
		};
	}

	return {
		amount_usd: readNumber(args, ["amountUsd", "amount_usd", "usdAmount"]),
		token_mint: readString(args, [
			"tokenMint",
			"outputTokenMint",
			"toTokenMint",
		]),
		token_known: readBoolean(args, ["tokenKnown", "token_known"]),
		protocol: readString(args, ["protocol"]),
		slippage_bps: readNumber(args, ["slippageBps", "slippage_bps"]),
	};
}

function buildAuditWriteRequest(
	request: EvaluateActionRequest,
	response: EvaluateActionResponse,
): AuditWriteRequest {
	return {
		idempotencyKey: request.idempotencyKey,
		userId: request.userId,
		sessionId: request.sessionId,
		entry: {
			correlationId: response.correlationId,
			auditRef: response.auditRef,
			toolName: request.toolName,
			decision: response.decision,
			riskLevel: response.riskLevel,
			reasons: response.reasons,
			occurredAt: request.requestedAt,
		},
	};
}

function mapHostedDecision(
	decision: PolicyEvaluation["decision"],
): EvaluateActionResponse["decision"] {
	switch (decision) {
		case COMPASS_DECISIONS.ALLOW:
			return "allow";
		case COMPASS_DECISIONS.DENY:
			return "deny";
		default:
			return "confirm";
	}
}

function mapRiskLevel(
	decision: PolicyEvaluation["decision"],
): HostedRiskLevel {
	switch (decision) {
		case COMPASS_DECISIONS.ALLOW:
			return HOSTED_RISK_LEVELS.LOW;
		case COMPASS_DECISIONS.DENY:
			return HOSTED_RISK_LEVELS.HIGH;
		default:
			return HOSTED_RISK_LEVELS.MEDIUM;
	}
}

function buildSuggestedAction(
	decision: PolicyEvaluation["decision"],
): string | undefined {
	if (decision === COMPASS_DECISIONS.ALLOW) {
		return undefined;
	}

	if (decision === COMPASS_DECISIONS.DENY) {
		return "Review the policy and risk signals before retrying.";
	}

	return "Request explicit user confirmation before execution.";
}

function readString(
	record: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}

	return undefined;
}

function readNumber(
	record: Record<string, unknown>,
	keys: string[],
): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}

	return undefined;
}

function readBoolean(
	record: Record<string, unknown>,
	keys: string[],
): boolean | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "boolean") {
			return value;
		}
	}

	return undefined;
}
