import { Horizon, rpc } from "@stellar/stellar-sdk";

import { debug } from "@back/guardrail/debugLogger";

import { getStellarNetworkConfig } from "./stellarNetworkConfig";

/**
 * Lazy, singleton Stellar clients (Stellar Wave 1), mirroring
 * `back/services/solana/providers/solanaConnection.ts`.
 *
 * Horizon is the primary client for classic Stellar multisig account-state
 * reads (balances, signers, thresholds). Soroban RPC is for smart-contract
 * calls in later waves. Constructing the clients performs no network I/O.
 */

let horizonServer: Horizon.Server | null = null;
let sorobanRpc: rpc.Server | null = null;

export function getHorizonServer(): Horizon.Server {
	if (!horizonServer) {
		const { horizonUrl } = getStellarNetworkConfig();
		debug("connection", "createHorizonServer", "Creating Horizon server", {
			url: horizonUrl,
		});
		horizonServer = new Horizon.Server(horizonUrl);
	}
	return horizonServer;
}

export function getSorobanRpc(): rpc.Server {
	if (!sorobanRpc) {
		const { rpcUrl } = getStellarNetworkConfig();
		debug("connection", "createSorobanRpc", "Creating Soroban RPC server", {
			url: rpcUrl,
		});
		sorobanRpc = new rpc.Server(rpcUrl);
	}
	return sorobanRpc;
}

/** Test-only: drops the cached clients so config changes are picked up. */
export function resetStellarClients(): void {
	horizonServer = null;
	sorobanRpc = null;
}
