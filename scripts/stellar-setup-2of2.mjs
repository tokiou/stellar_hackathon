#!/usr/bin/env node
/**
 * One-time bootstrap: turn the AGENT's Privy account into a native 2-of-2
 * (agent master weight 1 + Compass weight 1, threshold 2) on Testnet.
 *
 * The agent's master key is custodied by Privy, so the setOptions that raises
 * the thresholds must be signed by the agent's Privy wallet (rawSign) — this
 * script does exactly that, then verifies Compass is genuinely required.
 *
 * Reads the same env as the proxy (load it first):
 *   set -a; . ./.compass-privy.env; set +a
 *   npx tsx scripts/stellar-setup-2of2.mjs
 *
 * Requires: COMPASS_STELLAR_AGENT_PRIVY_WALLET_ID / _PUBLIC_KEY (agent),
 *           COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY (Compass co-signer),
 *           PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_AUTHORIZATION_KEY.
 */
import { TransactionBuilder } from "@stellar/stellar-sdk";

import { fundTestnetAccount } from "../back/services/stellar/providers/friendbot";
import { getHorizonServer } from "../back/services/stellar/providers/stellarConnection";
import { getStellarNetworkConfig } from "../back/services/stellar/providers/stellarNetworkConfig";
import {
	assertCompassRequired,
	buildMultisigSetupEnvelope,
} from "../back/services/stellar/demo/stellarMultisigSetup";
import { createAgentPrivySigner } from "../back/services/stellar/signer/privyAgentSigner";
import { resolveStellarCosigner } from "../back/services/stellar/signer/stellarCosignerFactory";

const OK = "\x1b[32m✓\x1b[0m";
const INFO = "\x1b[36m→\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

async function main() {
	const config = getStellarNetworkConfig();

	const agentSigner = createAgentPrivySigner();
	const agentPublicKey = agentSigner.getPublicKey();
	if (!agentPublicKey) {
		throw new Error(
			"Agent wallet not configured. Set COMPASS_STELLAR_AGENT_PRIVY_WALLET_ID and COMPASS_STELLAR_AGENT_PRIVY_WALLET_PUBLIC_KEY (run scripts/privy-setup.mjs).",
		);
	}

	const cosigner = resolveStellarCosigner();
	const compassPublicKey = cosigner.getPublicKey();
	if (!compassPublicKey) {
		throw new Error("Compass co-signer not configured (COMPASS_STELLAR_PRIVY_WALLET_*).");
	}

	console.log(`${INFO} Agent (master):   ${agentPublicKey}`);
	console.log(`${INFO} Compass (signer): ${compassPublicKey}`);

	const server = getHorizonServer();

	// Fund the agent account if it does not exist yet.
	try {
		await server.loadAccount(agentPublicKey);
		console.log(`${OK} Agent account already exists on-chain.`);
	} catch {
		console.log(`${INFO} Funding agent account via Friendbot...`);
		await fundTestnetAccount(agentPublicKey);
		console.log(`${OK} Agent account funded.`);
	}

	const loaded = await server.loadAccount(agentPublicKey);

	// Already 2-of-2? Skip.
	const before = await cosigner.inspectAccount(agentPublicKey);
	if (
		before.exists &&
		(before.signers ?? []).includes(compassPublicKey) &&
		typeof before.threshold === "number" &&
		before.threshold >= 2
	) {
		console.log(`${OK} Account is already a 2-of-2 with Compass (threshold ${before.threshold}). Nothing to do.`);
		return;
	}

	// Build setOptions and sign it with the agent's Privy wallet (master weight 1
	// suffices because current thresholds are still 0 until this op applies).
	const setupXdr = buildMultisigSetupEnvelope({
		accountId: agentPublicKey,
		sequence: loaded.sequenceNumber(),
		compassSignerPublicKey: compassPublicKey,
		networkPassphrase: config.networkPassphrase,
	});
	console.log(`${INFO} Signing setOptions with the agent's Privy wallet...`);
	const signedXdr = await agentSigner.sign(setupXdr);

	const tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
	await server.submitTransaction(tx);
	console.log(`${OK} setOptions submitted — account is now 2-of-2.`);

	const after = await cosigner.inspectAccount(agentPublicKey);
	assertCompassRequired(after, compassPublicKey);
	console.log(`${OK} Verified: Compass is a required signer (threshold ${after.threshold}).`);
	console.log(`\n${OK} Done. The proxy can now co-sign agent payments on ALLOW.`);
}

main().catch((error) => {
	console.error(`${FAIL} Setup failed:`, error?.response?.data?.extras?.result_codes ?? error.message ?? error);
	process.exit(1);
});
