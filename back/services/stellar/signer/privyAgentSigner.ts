import { TransactionBuilder } from "@stellar/stellar-sdk";

import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import {
	createRealPrivyWalletClient,
	normalizeRawSignature,
	type PrivyWalletClient,
} from "./privyClient";

/**
 * The AGENT's Privy signer — produces the FIRST signature on a transaction.
 *
 * Distinct from the Compass co-signer: this is the agent's own Privy server
 * wallet (its identity / spending key). The agent signs its own request; the
 * Compass co-signer adds the second signature only on policy ALLOW. Both keys
 * are custodied by Privy (TEE); together they satisfy the 2-of-2 account.
 *
 * The signing is UNGATED here (it is the agent asserting intent). The policy
 * gate lives in the Compass co-signer.
 */

export type AgentPrivyConfig = {
	appId: string;
	appSecret: string;
	walletId: string;
	walletPublicKey: string; // agent's Stellar G… address
	authorizationPrivateKey?: string;
};

export function resolveAgentPrivyConfig(
	env: Record<string, string | undefined>,
): AgentPrivyConfig | null {
	const appId = env.PRIVY_APP_ID?.trim();
	const appSecret = env.PRIVY_APP_SECRET?.trim();
	const walletId = env.COMPASS_STELLAR_AGENT_PRIVY_WALLET_ID?.trim();
	const walletPublicKey = env.COMPASS_STELLAR_AGENT_PRIVY_WALLET_PUBLIC_KEY?.trim();
	const authorizationPrivateKey = env.PRIVY_AUTHORIZATION_KEY?.trim();
	if (!appId || !appSecret || !walletId || !walletPublicKey) {
		return null;
	}
	return { appId, appSecret, walletId, walletPublicKey, authorizationPrivateKey };
}

export interface AgentPrivySigner {
	getPublicKey(): string | null;
	/** Adds the agent's signature to the envelope and returns the new XDR. */
	sign(envelopeXdr: string): Promise<string>;
}

export type AgentPrivySignerDeps = {
	env?: Record<string, string | undefined>;
	client?: PrivyWalletClient;
};

export function createAgentPrivySigner(
	deps: AgentPrivySignerDeps = {},
): AgentPrivySigner {
	const env = deps.env ?? process.env;

	return {
		getPublicKey(): string | null {
			return resolveAgentPrivyConfig(env)?.walletPublicKey ?? null;
		},

		async sign(envelopeXdr: string): Promise<string> {
			const config = resolveAgentPrivyConfig(env);
			if (!config) {
				throw new Error("AGENT_PRIVY_NOT_CONFIGURED");
			}
			const passphrase = getStellarNetworkConfig(env).networkPassphrase;
			const client =
				deps.client ??
				createRealPrivyWalletClient({
					appId: config.appId,
					appSecret: config.appSecret,
				});

			const tx = TransactionBuilder.fromXDR(envelopeXdr, passphrase);
			const hashHex = `0x${tx.hash().toString("hex")}`;
			const response = await client.rawSign(config.walletId, {
				params: { hash: hashHex },
				...(config.authorizationPrivateKey
					? {
							authorization_context: {
								authorization_private_keys: [config.authorizationPrivateKey],
							},
						}
					: {}),
			});
			tx.addSignature(config.walletPublicKey, normalizeRawSignature(response));
			return tx.toXDR();
		},
	};
}
