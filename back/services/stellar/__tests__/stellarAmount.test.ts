import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
	STROOPS_PER_XLM,
	canonicalizeAmount,
	displayToNumber,
	displayToStroops,
	stroopsToDisplay,
} from "../transactions/stellarAmount";

describe("stellarAmount", () => {
	it("uses a 7-decimal divisor (10^7), distinct from Solana lamports (10^9)", () => {
		expect(STROOPS_PER_XLM).toBe(BigInt(10_000_000));
		expect(Number(STROOPS_PER_XLM)).not.toBe(LAMPORTS_PER_SOL);
	});

	it("converts 1 XLM to 10,000,000 stroops", () => {
		expect(displayToStroops("1")).toBe(BigInt(10_000_000));
		expect(displayToStroops("1.5")).toBe(BigInt(15_000_000));
		expect(displayToStroops("0.0000001")).toBe(BigInt(1));
	});

	it("converts stroops back to a 7-decimal display string", () => {
		expect(stroopsToDisplay(BigInt(10_000_000))).toBe("1.0000000");
		expect(stroopsToDisplay(BigInt(15_000_000))).toBe("1.5000000");
		expect(stroopsToDisplay(BigInt(1))).toBe("0.0000001");
	});

	it("canonicalizes to a 7-decimal string and round-trips through stroops", () => {
		expect(canonicalizeAmount("1.5")).toBe("1.5000000");
		expect(canonicalizeAmount("123.456789")).toBe("123.4567890");
		for (const stroops of [
			BigInt(1),
			BigInt(15_000_000),
			BigInt("1234567890"),
			BigInt("9999999999999"),
		]) {
			expect(displayToStroops(stroopsToDisplay(stroops))).toBe(stroops);
		}
	});

	it("rejects amounts with more than 7 decimals", () => {
		expect(() => displayToStroops("1.12345678")).toThrow(
			/STELLAR_AMOUNT_TOO_PRECISE/,
		);
	});

	it("rejects non-numeric amounts", () => {
		expect(() => displayToStroops("abc")).toThrow(/STELLAR_INVALID_AMOUNT/);
	});

	it("displayToNumber yields a number only at the edge", () => {
		expect(displayToNumber("1.5000000")).toBeCloseTo(1.5, 7);
	});
});
