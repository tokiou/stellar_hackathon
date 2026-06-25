import { describe, expect, it } from "vitest";

import {
	DEFAULT_FALLBACK_XLM_USD_PRICE,
	createStellarPriceProvider,
} from "../providers/stellarPriceProvider";
import type { StellarAssetFact } from "../transactions/stellarTransactionContracts";

const NATIVE: StellarAssetFact = { kind: "native", symbol: "XLM" };
const ISSUED: StellarAssetFact = {
	kind: "issued",
	code: "USDC",
	issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

describe("stellarPriceProvider", () => {
	it("values native XLM with the configured FALLBACK_XLM_USD_PRICE", async () => {
		const provider = createStellarPriceProvider({ FALLBACK_XLM_USD_PRICE: "0.25" });
		await expect(provider.amountToUsd(NATIVE, "10.0000000")).resolves.toBeCloseTo(
			2.5,
			7,
		);
	});

	it("falls back to the default native price when env is unset", async () => {
		const provider = createStellarPriceProvider({});
		await expect(provider.amountToUsd(NATIVE, "1.0000000")).resolves.toBeCloseTo(
			DEFAULT_FALLBACK_XLM_USD_PRICE,
			7,
		);
	});

	it("returns null for issued assets without a known price (stub)", async () => {
		const provider = createStellarPriceProvider({});
		await expect(provider.amountToUsd(ISSUED, "100.0000000")).resolves.toBeNull();
	});

	it("ignores a non-positive/invalid env price and uses the default", async () => {
		const provider = createStellarPriceProvider({ FALLBACK_XLM_USD_PRICE: "-5" });
		await expect(provider.amountToUsd(NATIVE, "1.0000000")).resolves.toBeCloseTo(
			DEFAULT_FALLBACK_XLM_USD_PRICE,
			7,
		);
	});
});
