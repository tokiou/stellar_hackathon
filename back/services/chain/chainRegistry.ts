import type { ChainAdapter, ChainId } from "@shared/chainContracts";

import { SolanaChainAdapter } from "./solana/solanaChainAdapter";
import { StellarChainAdapter } from "../stellar/stellarChainAdapter";

export type ResolveChainAdapterResult =
	| { ok: true; adapter: ChainAdapter }
	| { ok: false; reason: "CHAIN_ADAPTER_NOT_REGISTERED" };

/**
 * Single place that maps a `ChainId` to a concrete `ChainAdapter`. Only Solana
 * is registered in Stellar Wave 0. Resolving an unregistered chain fails
 * explicitly — it never silently falls back to Solana, which would be a
 * guardrail-bypass risk.
 */
const ADAPTER_FACTORIES: Partial<Record<ChainId, () => ChainAdapter>> = {
	solana: () => new SolanaChainAdapter(),
	stellar: () => new StellarChainAdapter(),
};

export function resolveChainAdapter(
	chainId: ChainId,
): ResolveChainAdapterResult {
	const factory = ADAPTER_FACTORIES[chainId];
	if (!factory) {
		return { ok: false, reason: "CHAIN_ADAPTER_NOT_REGISTERED" };
	}
	return { ok: true, adapter: factory() };
}
