#!/usr/bin/env node
/**
 * One-time REAL Privy setup for the Stellar 2-of-2 (agent + Compass).
 *
 * Requires real Privy app credentials (no simulation):
 *   PRIVY_APP_ID, PRIVY_APP_SECRET   (https://dashboard.privy.io → app settings)
 *
 * It:
 *   1. generates one P-256 authorization key pair (owns both wallets),
 *   2. creates TWO Stellar (Ed25519) server wallets:
 *        - the AGENT's wallet  (signs first, the agent's identity)
 *        - COMPASS's wallet     (co-signs on ALLOW)
 *   3. prints the env block to paste, plus the 2-of-2 account setup step.
 *
 * Run: PRIVY_APP_ID=... PRIVY_APP_SECRET=... npx tsx scripts/privy-setup.mjs
 *
 * Pass `--role agent` or `--role compass` to provision only one wallet
 * (e.g. when the agent and Compass live in separate deployments). Default: both.
 */
import { PrivyClient, generateP256KeyPair } from "@privy-io/node";
import { StrKey } from "@stellar/stellar-sdk";

const appId = process.env.PRIVY_APP_ID?.trim();
const appSecret = process.env.PRIVY_APP_SECRET?.trim();
if (!appId || !appSecret) {
	console.error("✗ Set PRIVY_APP_ID and PRIVY_APP_SECRET (from https://dashboard.privy.io).");
	process.exit(1);
}

const roleArg = (() => {
	const idx = process.argv.indexOf("--role");
	return idx >= 0 ? (process.argv[idx + 1] ?? "both") : "both";
})();
const roles =
	roleArg === "agent" ? ["agent"] : roleArg === "compass" ? ["compass"] : ["agent", "compass"];

const privy = new PrivyClient({ appId, appSecret });

const authKey = await generateP256KeyPair();

function toStellarAddress(wallet) {
	return wallet.address && StrKey.isValidEd25519PublicKey(wallet.address)
		? wallet.address
		: StrKey.encodeEd25519PublicKey(
				Buffer.from((wallet.public_key ?? "").replace(/^0x/, ""), "hex"),
			);
}

const created = {};
for (const role of roles) {
	const wallet = await privy.wallets().create({
		chain_type: "stellar",
		owner: { public_key: authKey.publicKey },
	});
	created[role] = { id: wallet.id, address: toStellarAddress(wallet) };
}

console.log("\n✓ Privy Stellar server wallet(s) created.\n");
console.log("Paste into your env (keep PRIVY_AUTHORIZATION_KEY secret):\n");
console.log(`export COMPASS_STELLAR_SIGNER_PROVIDER=privy`);
console.log(`export PRIVY_APP_ID=${appId}`);
console.log(`export PRIVY_APP_SECRET=${appSecret}`);
console.log(`export PRIVY_AUTHORIZATION_KEY='${authKey.privateKey}'`);
if (created.compass) {
	console.log(`export COMPASS_STELLAR_PRIVY_WALLET_ID=${created.compass.id}`);
	console.log(`export COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY=${created.compass.address}`);
}
if (created.agent) {
	console.log(`export COMPASS_STELLAR_AGENT_PRIVY_WALLET_ID=${created.agent.id}`);
	console.log(`export COMPASS_STELLAR_AGENT_PRIVY_WALLET_PUBLIC_KEY=${created.agent.address}`);
}

if (created.agent) {
	console.log(`\nAgent address   (master): ${created.agent.address}`);
}
if (created.compass) {
	console.log(`Compass address (co-signer): ${created.compass.address}`);
}

if (created.agent && created.compass) {
	console.log("\nNext — make it a native 2-of-2 account (one-time, owner-driven):");
	console.log(`  1. Fund the AGENT account via Friendbot:`);
	console.log(`       curl "https://friendbot.stellar.org/?addr=${created.agent.address}"`);
	console.log(
		`  2. setOptions on the agent account: add Compass as a signer (weight 1) and`,
	);
	console.log(`     set med/high threshold = 2 (master weight stays 1).`);
	console.log(
		`     The agent account then REQUIRES both signatures — Compass's co-sign is non-bypassable.`,
	);
}
