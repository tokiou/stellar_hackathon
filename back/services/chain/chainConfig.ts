import type { ChainId } from "@shared/chainContracts";

export interface ChainConfig {
	chain: ChainId;
	network: string;
}

const VALID_CHAINS: readonly ChainId[] = ["solana", "stellar"];

const DEFAULT_CHAIN_CONFIG: ChainConfig = {
	chain: "solana",
	network: "solana",
};

/**
 * Resolves the active chain/network from SERVER configuration (env), never from
 * the request payload (see docs/stellar-wave-0-chain-adapter-boundary
 * openQuestion Q2 — trusting a client-supplied chain would let a caller pick
 * which adapter and which policy thresholds apply). The default resolves to
 * Solana, preserving today's behavior with zero runtime change.
 */
export function resolveChainConfig(
	env: NodeJS.ProcessEnv = process.env,
): ChainConfig {
	const chain = env.COMPASS_CHAIN;
	const network = env.COMPASS_NETWORK;

	return {
		chain:
			chain && VALID_CHAINS.includes(chain as ChainId)
				? (chain as ChainId)
				: DEFAULT_CHAIN_CONFIG.chain,
		network:
			network && network.trim().length > 0
				? network.trim()
				: DEFAULT_CHAIN_CONFIG.network,
	};
}
