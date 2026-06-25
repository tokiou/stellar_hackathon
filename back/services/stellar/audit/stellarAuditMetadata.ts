import type { ChainAuditMetadata } from "@shared/chainContracts";
import {
	AUDIT_LIFECYCLE_STATES,
	type AuditEntry,
	type AuditLifecycleState,
} from "@shared/evaluationContracts";

/**
 * Builds the additive Stellar audit fields (Stellar Wave 5) from Wave 0's
 * neutral `ChainAuditMetadata` and Wave 4's co-signing result, so the audit
 * record alone proves the multisig story (collected vs required signers and
 * threshold). It carries only semantic facts — never raw XDR, tx bytes, or
 * secret material.
 */

export type StellarCoSigningResult = {
	/** Whether Compass added its signature. */
	cosigned: boolean;
	/** Whether the brain's decision denied the action. */
	denied?: boolean;
	requiredSigners: number;
	collectedSigners: number;
	threshold: number;
	/** Present only on successful execution. */
	txHash?: string;
	/** Present only on submission failure. */
	networkError?: string;
};

export type StellarAuditFields = Pick<
	AuditEntry,
	| "chain"
	| "network"
	| "sourceAccount"
	| "destination"
	| "asset"
	| "amount"
	| "requiredSigners"
	| "collectedSigners"
	| "threshold"
	| "txHash"
	| "networkError"
	| "lifecycle"
>;

function deriveLifecycle(cosign: StellarCoSigningResult): AuditLifecycleState {
	if (cosign.denied) {
		return AUDIT_LIFECYCLE_STATES.DENIED;
	}
	if (cosign.networkError) {
		return AUDIT_LIFECYCLE_STATES.REJECTED;
	}
	if (cosign.txHash) {
		return AUDIT_LIFECYCLE_STATES.CONFIRMED;
	}
	if (cosign.cosigned) {
		return AUDIT_LIFECYCLE_STATES.COSIGNED_BY_COMPASS;
	}
	return AUDIT_LIFECYCLE_STATES.PROPOSED;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function buildStellarAuditMetadata(
	meta: ChainAuditMetadata,
	cosign: StellarCoSigningResult,
): StellarAuditFields {
	return {
		chain: meta.chainId,
		network: meta.network,
		sourceAccount: optionalString(meta.sourceAddress),
		destination: optionalString(meta.recipientAddress),
		asset: optionalString(meta.asset),
		amount: optionalNumber(meta.amount),
		requiredSigners: cosign.requiredSigners,
		collectedSigners: cosign.collectedSigners,
		threshold: cosign.threshold,
		txHash: cosign.txHash,
		networkError: cosign.networkError,
		lifecycle: deriveLifecycle(cosign),
	};
}
