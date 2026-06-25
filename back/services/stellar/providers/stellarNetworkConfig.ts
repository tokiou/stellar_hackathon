import { Networks } from "@stellar/stellar-sdk";

/**
 * Stellar network configuration (Stellar Wave 1).
 *
 * Mirrors `back/services/solana/providers/solanaNetworkConfig.ts`: a coded
 * error factory, a `resolve*` guard, and a `get*Config` builder. The only
 * supported network is Testnet. The network passphrase is the security-critical
 * field and is REQUIRED (never assumed) — a mainnet passphrase is rejected with
 * a coded error so the system never silently talks to mainnet.
 */

export type StellarNetwork = "testnet";

export type StellarNetworkConfig = {
	network: StellarNetwork;
	networkPassphrase: string;
	horizonUrl: string;
	rpcUrl: string;
	friendbotUrl: string;
};

export type StellarNetworkErrorCode =
	| "unsupported_network"
	| "missing_network_config"
	| "invalid_network_config"
	| "mainnet_forbidden";

type StellarNetworkError = Error & { code: StellarNetworkErrorCode };

export const TESTNET_PASSPHRASE = Networks.TESTNET; // "Test SDF Network ; September 2015"
export const MAINNET_PASSPHRASE = Networks.PUBLIC;

export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
export const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";

const FALLBACK_NETWORK = "testnet" as const;

function createError(
	code: StellarNetworkErrorCode,
	message: string,
): StellarNetworkError {
	const error = new Error(message) as StellarNetworkError;
	error.code = code;
	return error;
}

function resolveUrl(
	value: string | undefined,
	fallback: string,
	label: string,
): string {
	const url = value?.trim() || fallback;
	if (!/^https?:\/\//.test(url)) {
		throw createError(
			"invalid_network_config",
			`Invalid ${label} URL: ${url}`,
		);
	}
	return url;
}

export function resolveStellarNetwork(network?: string | null): StellarNetwork {
	const requested = network?.trim().toLowerCase() || FALLBACK_NETWORK;
	if (requested !== FALLBACK_NETWORK) {
		throw createError(
			"unsupported_network",
			`Unsupported Stellar network ${requested}`,
		);
	}
	return FALLBACK_NETWORK;
}

export function getStellarNetworkConfig(
	env: Record<string, string | undefined> = process.env,
): StellarNetworkConfig {
	const network = resolveStellarNetwork(env.STELLAR_NETWORK);

	const passphrase = env.STELLAR_NETWORK_PASSPHRASE?.trim();
	if (!passphrase) {
		throw createError(
			"missing_network_config",
			"STELLAR_NETWORK_PASSPHRASE is required",
		);
	}
	if (passphrase === MAINNET_PASSPHRASE) {
		throw createError(
			"mainnet_forbidden",
			"Mainnet passphrase is forbidden; Compass on Stellar is testnet-only",
		);
	}
	if (passphrase !== TESTNET_PASSPHRASE) {
		throw createError(
			"invalid_network_config",
			"STELLAR_NETWORK_PASSPHRASE does not match the Stellar Testnet passphrase",
		);
	}

	return {
		network,
		networkPassphrase: passphrase,
		horizonUrl: resolveUrl(env.STELLAR_HORIZON_URL, DEFAULT_HORIZON_URL, "Horizon"),
		rpcUrl: resolveUrl(env.STELLAR_RPC_URL, DEFAULT_RPC_URL, "Soroban RPC"),
		friendbotUrl: resolveUrl(
			env.STELLAR_FRIENDBOT_URL,
			DEFAULT_FRIENDBOT_URL,
			"Friendbot",
		),
	};
}

export function isSupportedStellarNetwork(
	network: string | undefined | null,
): network is StellarNetwork {
	try {
		resolveStellarNetwork(network);
		return true;
	} catch {
		return false;
	}
}

export type StellarServiceError = StellarNetworkError;
