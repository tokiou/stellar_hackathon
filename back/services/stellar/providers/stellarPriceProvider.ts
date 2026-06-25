import { displayToNumber } from "../transactions/stellarAmount";
import type {
	StellarAssetFact,
	StellarPriceProvider,
} from "../transactions/stellarTransactionContracts";

/**
 * Maps a Stellar amount to USD (Stellar Wave 2). Mirrors the Solana
 * `FALLBACK_SOL_USD_PRICE` pattern: a configurable stub fallback for native
 * XLM. Issued assets without a known price return `null` (stub/allowlist, Q1) —
 * the decoder treats that as "USD unknown", never as zero value silently.
 */

export const DEFAULT_FALLBACK_XLM_USD_PRICE = 0.1;

export function createStellarPriceProvider(
	env: Record<string, string | undefined> = process.env,
): StellarPriceProvider {
	const parsed = Number(env.FALLBACK_XLM_USD_PRICE);
	const fallbackXlmUsd =
		Number.isFinite(parsed) && parsed > 0
			? parsed
			: DEFAULT_FALLBACK_XLM_USD_PRICE;

	return {
		async amountToUsd(
			asset: StellarAssetFact,
			amount: string,
		): Promise<number | null> {
			const quantity = displayToNumber(amount);
			if (!Number.isFinite(quantity)) {
				return null;
			}
			if (asset.kind === "native") {
				return quantity * fallbackXlmUsd;
			}
			// Issued assets: no testnet price source yet (Wave 2 stub).
			return null;
		},
	};
}
