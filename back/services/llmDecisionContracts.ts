/**
 * LLM Decision Contracts - types and schema for the advisory LLM judge.
 *
 * Contracts live separately from behavior per project convention.
 * The LLM judge is default-off and advisory-only; it can never loosen
 * a deterministic decision.
 */

import type { CompassDecision } from "./executionGatewayContracts";

// ---------------------------------------------------------------------------
// LLM Judge configuration
// ---------------------------------------------------------------------------

export type LlmJudgeConfig = {
	/** When false or unset, no LLM calls are attempted. */
	enabled: boolean;
	/** Provider key, e.g. "opencode-go" or "openai". */
	provider?: string;
	/** Model name, e.g. "kimi-k2.5". */
	model?: string;
	/** Provider endpoint. Required for opencode-go compatible runtime calls. */
	baseUrl?: string;
	/** Provider credential - never logged or persisted. */
	apiKey?: string;
	/** Judge timeout in ms. Defaults to 3000. */
	timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Sanitized LLM judge input (after redaction)
// ---------------------------------------------------------------------------

export type LlmJudgeInput = {
	toolName: string;
	actionKind: string;
	network: string;
	deterministicDecision: CompassDecision;
	riskClass: string;
	reasonCodes: string[];
	policyId?: string;
	evaluatedRules?: string[];
	sanitizedContext?: Record<string, unknown>;
	sanitized: true;
};

// ---------------------------------------------------------------------------
// LLM judge output (must validate against LlmGuardDecision)
// ---------------------------------------------------------------------------

export const LLM_GUARD_DECISIONS = {
	ALLOW: "ALLOW",
	DENY: "DENY",
	REQUIRE_HUMAN_APPROVAL: "REQUIRE_HUMAN_APPROVAL",
	REQUIRE_ADDITIONAL_CONTEXT: "REQUIRE_ADDITIONAL_CONTEXT",
} as const;

export type LlmGuardDecision =
	(typeof LLM_GUARD_DECISIONS)[keyof typeof LLM_GUARD_DECISIONS];

export type LlmGuardOutput = {
	decision: LlmGuardDecision;
	confidence: number;
	reasonCodes: string[];
	rationale: string;
};

// ---------------------------------------------------------------------------
// Decision clamp result
// ---------------------------------------------------------------------------

export type LlmClampedDecision = {
	/** Final decision after clamping - never looser than deterministic. */
	decision: CompassDecision;
	/** Whether the LLM judge was consulted at all. */
	llmConsulted: boolean;
	/** Raw LLM output (undefined if not consulted or failed). */
	llmOutput?: LlmGuardOutput;
	/** Whether the LLM output was clamped (tightened or kept same). */
	clamped: boolean;
	/** reasonCodes from LLM if consulted and valid. */
	llmReasonCodes?: string[];
	/** rationale from LLM if consulted and valid. */
	llmRationale?: string;
};

// ---------------------------------------------------------------------------
// Decision clamp rules
// ---------------------------------------------------------------------------

/**
 * The LLM may keep or tighten a deterministic decision, but never loosen it.
 * DENY can only stay DENY. ALLOW can become any stricter decision.
 */
export const LLM_DECISION_STRICTNESS: Record<CompassDecision, LlmGuardDecision[]> = {
	ALLOW: [
		LLM_GUARD_DECISIONS.ALLOW,
		LLM_GUARD_DECISIONS.REQUIRE_HUMAN_APPROVAL,
		LLM_GUARD_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		LLM_GUARD_DECISIONS.DENY,
	],
	REQUIRE_HUMAN_APPROVAL: [
		LLM_GUARD_DECISIONS.REQUIRE_HUMAN_APPROVAL,
		LLM_GUARD_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		LLM_GUARD_DECISIONS.DENY,
	],
	REQUIRE_SIMULATION: [
		LLM_GUARD_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		LLM_GUARD_DECISIONS.DENY,
	],
	REQUIRE_POLICY_UPDATE: [
		LLM_GUARD_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		LLM_GUARD_DECISIONS.DENY,
	],
	REQUIRE_ADDITIONAL_CONTEXT: [
		LLM_GUARD_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		LLM_GUARD_DECISIONS.DENY,
	],
	DENY: [LLM_GUARD_DECISIONS.DENY],
};

// ---------------------------------------------------------------------------
// Sanitizer redaction markers
// ---------------------------------------------------------------------------

export const LLM_REDACTED = "[REDACTED]";
export const LLM_TRUNCATED = "[TRUNCATED]";
export const LLM_MAX_VALUE_LENGTH = 256;
export const LLM_MAX_OBJECT_DEPTH = 5;

// Sensitive key substrings that must be redacted regardless of nesting.
export const LLM_SENSITIVE_KEY_PATTERNS: readonly string[] = [
	"prompt",
	"secret",
	"privatekey",
	"private_key",
	"seed",
	"mnemonic",
	"rawtransaction",
	"raw_transaction",
	"unsignedversionedtransaction",
	"unsigned_versioned_transaction",
	"unsignedtransaction",
	"unsigned_transaction",
	"transactionpayload",
	"transaction_payload",
	"authorization",
	"token",
	"cookie",
	"jwt",
	"apikey",
	"api_key",
	"password",
	"credential",
	"signer",
	"keypair",
	"secretkey",
	"secret_key",
];
