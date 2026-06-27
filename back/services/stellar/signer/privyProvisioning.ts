import { Keypair, StrKey } from "@stellar/stellar-sdk";

import {
	createRealPrivyWalletClient,
	type PrivyCreatedWallet,
	type PrivyWalletClient,
} from "./privyClient";

/**
 * Privy onboarding: provisions the agent's Stellar (Ed25519) server wallet.
 *
 * Standalone and independent of the MCP layer — it only needs Privy app
 * credentials. When credentials are absent it falls back to a SIMULATED wallet
 * (a local Ed25519 keypair, StrKey-encoded) so the flow/encoding is validatable
 * without a Privy account; the real path uses Privy's `wallets().create`.
 */

export type ProvisionResult =
	| {
			ok: true;
			provider: "privy" | "simulated";
			walletId: string;
			stellarPublicKey: string; // G… address
			/** Present only for simulated provisioning (testnet demos). */
			simulatedSecret?: string;
	  }
	| { ok: false; reason: "PROVISION_FAILED"; message: string };

export type ProvisionDeps = {
	env?: Record<string, string | undefined>;
	/** Injected Privy client for tests; real client built lazily otherwise. */
	client?: PrivyWalletClient;
	userId?: string;
};

/** Derives the Stellar G… address from a created wallet (address or raw pubkey). */
export function toStellarAddress(wallet: PrivyCreatedWallet): string {
	if (wallet.address && StrKey.isValidEd25519PublicKey(wallet.address)) {
		return wallet.address;
	}
	const hex = (wallet.public_key ?? "").replace(/^0x/, "");
	if (!hex) {
		throw new Error("PRIVY_WALLET_MISSING_PUBLIC_KEY");
	}
	return StrKey.encodeEd25519PublicKey(Buffer.from(hex, "hex"));
}

export async function provisionStellarWallet(
	deps: ProvisionDeps = {},
): Promise<ProvisionResult> {
	const env = deps.env ?? process.env;
	const appId = env.PRIVY_APP_ID?.trim();
	const appSecret = env.PRIVY_APP_SECRET?.trim();

	// Simulated path: no Privy credentials -> validate the flow with a local key.
	if (!deps.client && (!appId || !appSecret)) {
		const kp = Keypair.random();
		return {
			ok: true,
			provider: "simulated",
			walletId: `sim_${kp.publicKey().slice(0, 8)}`,
			stellarPublicKey: kp.publicKey(),
			simulatedSecret: kp.secret(),
		};
	}

	const client =
		deps.client ??
		createRealPrivyWalletClient({ appId: appId as string, appSecret: appSecret as string });

	if (typeof client.create !== "function") {
		return {
			ok: false,
			reason: "PROVISION_FAILED",
			message: "Privy client does not support wallet creation.",
		};
	}

	try {
		const wallet = await client.create({
			chain_type: "stellar",
			...(deps.userId ? { user_id: deps.userId } : {}),
		});
		return {
			ok: true,
			provider: "privy",
			walletId: wallet.id,
			stellarPublicKey: toStellarAddress(wallet),
		};
	} catch (error) {
		return {
			ok: false,
			reason: "PROVISION_FAILED",
			message: (error as Error).message,
		};
	}
}
