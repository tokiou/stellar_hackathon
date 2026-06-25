/**
 * Stellar amount conversion (Stellar Wave 2).
 *
 * Stellar uses 7 decimals: 1 XLM = 10,000,000 stroops (10^7). This is DISTINCT
 * from Solana lamports (10^9). All money math is done with bigint/string to
 * avoid floating-point drift; numbers are only produced at the very edge.
 *
 * Note: the repo targets ES2017, so bigint LITERALS (`10n`) are unavailable —
 * we use `BigInt(...)` calls, which compile and run fine on the Node runtime.
 */

export const STELLAR_DECIMALS = 7;
export const STROOPS_PER_XLM = BigInt(10_000_000); // 10^7

const ZERO = BigInt(0);
const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

export function displayToStroops(display: string): bigint {
	const trimmed = display.trim();
	if (!AMOUNT_PATTERN.test(trimmed)) {
		throw new Error(`STELLAR_INVALID_AMOUNT: ${display}`);
	}
	const negative = trimmed.startsWith("-");
	const unsigned = negative ? trimmed.slice(1) : trimmed;
	const [whole, frac = ""] = unsigned.split(".");
	if (frac.length > STELLAR_DECIMALS) {
		throw new Error(`STELLAR_AMOUNT_TOO_PRECISE: ${display}`);
	}
	const fracPadded = frac.padEnd(STELLAR_DECIMALS, "0");
	const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
	return negative ? -stroops : stroops;
}

export function stroopsToDisplay(stroops: bigint | string): string {
	const value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
	const negative = value < ZERO;
	const abs = negative ? -value : value;
	const whole = abs / STROOPS_PER_XLM;
	const frac = (abs % STROOPS_PER_XLM)
		.toString()
		.padStart(STELLAR_DECIMALS, "0");
	return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Canonicalize a display amount to a 7-decimal string (round-trips via stroops). */
export function canonicalizeAmount(display: string): string {
	return stroopsToDisplay(displayToStroops(display));
}

/** Edge conversion to a number, only for USD valuation. */
export function displayToNumber(display: string): number {
	return Number(display);
}
