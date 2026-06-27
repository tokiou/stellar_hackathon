#!/usr/bin/env node
/**
 * One-time REAL Privy setup for the Stellar co-signer.
 *
 * Requires real Privy app credentials (no simulation):
 *   PRIVY_APP_ID, PRIVY_APP_SECRET   (https://dashboard.privy.io → app settings)
 *
 * It:
 *   1. generates a P-256 authorization key pair,
 *   2. creates a Stellar (Ed25519) server wallet owned by that key,
 *   3. prints the env block to paste so Compass co-signs via real Privy.
 *
 * Run: PRIVY_APP_ID=... PRIVY_APP_SECRET=... npx tsx scripts/privy-setup.mjs
 */
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";
import { StrKey } from "@stellar/stellar-sdk";

const appId = process.env.PRIVY_APP_ID?.trim();
const appSecret = process.env.PRIVY_APP_SECRET?.trim();
if (!appId || !appSecret) {
	console.error("✗ Set PRIVY_APP_ID and PRIVY_APP_SECRET (from https://dashboard.privy.io).");
	process.exit(1);
}

const privy = new PrivyClient({ appId, appSecret });

const authKey = await generateP256KeyPair();
const wallet = await privy.wallets().create({
	chain_type: "stellar",
	owner: { public_key: authKey.publicKey },
});

const address =
	wallet.address && StrKey.isValidEd25519PublicKey(wallet.address)
		? wallet.address
		: StrKey.encodeEd25519PublicKey(
				Buffer.from((wallet.public_key ?? "").replace(/^0x/, ""), "hex"),
			);

console.log("\n✓ Privy Stellar server wallet created.\n");
console.log("Paste into your env (keep PRIVY_AUTHORIZATION_KEY secret):\n");
console.log(`export COMPASS_STELLAR_SIGNER_PROVIDER=privy`);
console.log(`export PRIVY_APP_ID=${appId}`);
console.log(`export PRIVY_APP_SECRET=${appSecret}`);
console.log(`export COMPASS_STELLAR_PRIVY_WALLET_ID=${wallet.id}`);
console.log(`export COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY=${address}`);
console.log(`export PRIVY_AUTHORIZATION_KEY='${authKey.privateKey}'`);
console.log(`\nStellar address (fund via Friendbot if it must hold a balance): ${address}`);
