#!/usr/bin/env node
/**
 * Standalone validation of Privy Stellar wallet provisioning (independent of MCP).
 *   npx tsx scripts/stellar-privy-provision.mjs
 * Real Privy when PRIVY_APP_ID/PRIVY_APP_SECRET are set; simulated otherwise.
 * Optionally funds the new wallet on Testnet via Friendbot to prove it is usable.
 */
import { StrKey } from "@stellar/stellar-sdk";

import { provisionStellarWallet } from "../back/services/stellar/signer/privyProvisioning.ts";
import { fundTestnetAccount } from "../back/services/stellar/providers/friendbot.ts";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

const result = await provisionStellarWallet({ userId: process.env.PRIVY_USER_ID });
if (!result.ok) {
	console.error(`${FAIL} provisioning failed:`, result.message);
	process.exit(1);
}

console.log(`${PASS} provider: ${result.provider}`);
console.log(`${PASS} walletId: ${result.walletId}`);
console.log(`${PASS} stellar address: ${result.stellarPublicKey}`);
console.log(`${PASS} valid Stellar key: ${StrKey.isValidEd25519PublicKey(result.stellarPublicKey)}`);

if (process.env.FUND_ON_TESTNET === "true") {
	process.env.STELLAR_NETWORK_PASSPHRASE ||= "Test SDF Network ; September 2015";
	process.env.STELLAR_FRIENDBOT_URL ||= "https://friendbot.stellar.org";
	await fundTestnetAccount(result.stellarPublicKey);
	console.log(`${PASS} funded on Testnet via Friendbot (account now exists on ledger).`);
}
