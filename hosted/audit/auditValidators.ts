import {
	type AuditQueryValidationResult,
	type AuditWriteRequest,
	type AuditWriteValidationResult,
	DEFAULT_AUDIT_QUERY_LIMIT,
	MAX_AUDIT_QUERY_LIMIT,
} from "@shared/auditContracts";
import { AUDIT_LIFECYCLE_STATES, type AuditEntry } from "@shared/evaluationContracts";
import {
	isHostedDecision,
	isHostedRiskLevel,
} from "../evaluate/evaluationContracts";

const VALID_CHAINS = new Set<string>(["solana", "stellar"]);
const VALID_LIFECYCLES = new Set<string>(Object.values(AUDIT_LIFECYCLE_STATES));

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function optionalFiniteNumber(value: unknown): boolean {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function optionalNonNegativeInteger(value: unknown): boolean {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isInteger(value) && value >= 0)
	);
}

export function normalizeAuditQueryLimit(limit?: number): number {
	if (typeof limit !== "number" || Number.isNaN(limit)) {
		return DEFAULT_AUDIT_QUERY_LIMIT;
	}

	return Math.min(Math.max(Math.trunc(limit), 1), MAX_AUDIT_QUERY_LIMIT);
}

export function validateAuditWriteRequest(
	value: unknown,
): AuditWriteValidationResult {
	if (!isRecord(value)) {
		return { ok: false, message: "Request body must be a JSON object." };
	}

	if (!isNonEmptyString(value.idempotencyKey)) {
		return { ok: false, message: "idempotencyKey is required." };
	}

	if (!isAuditEntry(value.entry)) {
		return { ok: false, message: "entry is required and must be valid." };
	}

	return {
		ok: true,
		request: {
			idempotencyKey: value.idempotencyKey,
			entry: value.entry as AuditEntry,
			userId: isNonEmptyString(value.userId) ? value.userId : undefined,
			sessionId: isNonEmptyString(value.sessionId) ? value.sessionId : undefined,
		} satisfies AuditWriteRequest,
	};
}

export function validateAuditQueryParams(
	query: Record<string, string | undefined>,
): AuditQueryValidationResult {
	const userId = query.userId?.trim();
	const sessionId = query.sessionId?.trim();

	if (!userId && !sessionId) {
		return { ok: false, message: "userId or sessionId is required." };
	}

	const rawLimit = query.limit ? Number.parseInt(query.limit, 10) : undefined;

	return {
		ok: true,
		query: {
			userId,
			sessionId,
			limit: normalizeAuditQueryLimit(rawLimit),
		},
	};
}

function isAuditEntry(value: unknown): value is AuditEntry {
	if (!isRecord(value)) {
		return false;
	}

	return (
		isNonEmptyString(value.correlationId) &&
		isNonEmptyString(value.auditRef) &&
		isNonEmptyString(value.toolName) &&
		isHostedDecision(value.decision) &&
		isHostedRiskLevel(value.riskLevel) &&
		Array.isArray(value.reasons) &&
		value.reasons.every(isNonEmptyString) &&
		isNonEmptyString(value.occurredAt) &&
		// Stellar Wave 5: optional, additive fields — pass when absent, type-checked when present.
		(value.chain === undefined ||
			(typeof value.chain === "string" && VALID_CHAINS.has(value.chain))) &&
		optionalString(value.network) &&
		optionalString(value.sourceAccount) &&
		optionalString(value.destination) &&
		optionalString(value.asset) &&
		optionalFiniteNumber(value.amount) &&
		optionalNonNegativeInteger(value.requiredSigners) &&
		optionalNonNegativeInteger(value.collectedSigners) &&
		optionalNonNegativeInteger(value.threshold) &&
		optionalString(value.txHash) &&
		optionalString(value.networkError) &&
		(value.lifecycle === undefined ||
			(typeof value.lifecycle === "string" &&
				VALID_LIFECYCLES.has(value.lifecycle)))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
