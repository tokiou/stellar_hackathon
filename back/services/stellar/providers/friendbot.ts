import { debug } from "@back/guardrail/debugLogger";

import { getStellarNetworkConfig } from "./stellarNetworkConfig";

/**
 * Funds a Stellar Testnet account via Friendbot (Stellar Wave 1). Shared helper
 * usable by tests and by the Wave 6 demo script. Surfaces a clear error if
 * funding fails — it does not swallow failures.
 */
export async function fundTestnetAccount(
	publicKey: string,
): Promise<{ funded: boolean }> {
	const trimmed = publicKey?.trim();
	if (!trimmed) {
		throw new Error("FRIENDBOT_INVALID_PUBLIC_KEY");
	}

	const { friendbotUrl } = getStellarNetworkConfig();
	const url = `${friendbotUrl}?addr=${encodeURIComponent(trimmed)}`;

	debug("connection", "fundTestnetAccount", "Requesting Friendbot funding", {
		publicKey: trimmed,
	});

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`FRIENDBOT_FUNDING_FAILED: ${response.status} ${response.statusText}`,
		);
	}

	return { funded: true };
}
