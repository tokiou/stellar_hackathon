import type { SemanticFacts } from "@shared/chainContracts";

/**
 * Internal Stellar decode shapes (Stellar Wave 2). These are NOT brain
 * contracts — the brain only ever sees the neutral `SemanticFacts` from Wave 0.
 * They exist so the decoder can surface every operation in order (for Wave 3)
 * without leaking Stellar/XDR specifics upward.
 */

export type StellarAssetFact =
	| { kind: "native"; symbol: "XLM" }
	| { kind: "issued"; code: string; issuer: string };

export interface StellarDecodedOperation {
	index: number;
	operationKind: "payment" | "path_payment" | "other";
	/** Raw stellar-sdk operation type, e.g. "payment", "changeTrust", "setOptions". */
	rawType: string;
	recipientAddress?: string;
	asset?: StellarAssetFact;
	/** Display units, 7 decimals, as a decimal string (never a float). */
	amount?: string;
}

export type StellarDecodeResult =
	| { ok: true; facts: SemanticFacts; operations: StellarDecodedOperation[] }
	| {
			ok: false;
			reason: "MALFORMED_XDR" | "UNSUPPORTED_ENVELOPE";
			message: string;
	  };

export interface StellarPriceProvider {
	amountToUsd(asset: StellarAssetFact, amount: string): Promise<number | null>;
}

/** Neutral string encoding for `SemanticFacts.asset`. */
export function assetFactToString(asset: StellarAssetFact): string {
	return asset.kind === "native" ? "XLM" : `${asset.code}:${asset.issuer}`;
}
