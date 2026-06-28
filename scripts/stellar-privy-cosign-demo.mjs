#!/usr/bin/env node
/**
 * Modo B (co-signer) with the PRIVY adapter — end-to-end on Stellar Testnet.
 *
 * Proves: the user signs, Compass co-signs via the Privy adapter ONLY on ALLOW,
 * and the account's native multisig means a non-co-signed tx is rejected by the
 * network. Compass's signing key is the Privy server wallet — Compass never
 * holds the secret.
 *
 *   - Real Privy: set PRIVY_APP_ID, PRIVY_APP_SECRET,
 *     COMPASS_STELLAR_PRIVY_WALLET_ID, COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY.
 *     The adapter calls the real Privy rawSign API.
 *   - Simulated Privy (default when creds are absent): a local Ed25519 keypair
 *     stands in for Privy's TEE rawSign, so you can run the full on-chain flow
 *     now. The Compass signing code path is identical; only the key custody is
 *     simulated.
 *
 * Run: npx tsx scripts/stellar-privy-cosign-demo.mjs
 */

import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";

import { fundTestnetAccount } from "../back/services/stellar/providers/friendbot";
import { getHorizonServer } from "../back/services/stellar/providers/stellarConnection";
import { getStellarNetworkConfig } from "../back/services/stellar/providers/stellarNetworkConfig";
import { resolveStellarCosigner } from "../back/services/stellar/signer/stellarCosignerFactory";
import {
	assertCompassRequired,
	buildMultisigSetupEnvelope,
} from "../back/services/stellar/demo/stellarMultisigSetup";
import { runStellarGuard } from "../back/services/stellar/guard/stellarGuardPipeline";
import { DEFAULT_POLICY } from "../hosted/policy/defaultPolicy";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36m→\x1b[0m";

const REQUIRED_PRIVY_VARS = [
	"PRIVY_APP_ID",
	"PRIVY_APP_SECRET",
	"COMPASS_STELLAR_PRIVY_WALLET_ID",
	"COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY",
	"PRIVY_AUTHORIZATION_KEY",
];

async function main() {
	const config = getStellarNetworkConfig();

	// Privy is MANDATORY here — no simulation. Require real credentials.
	const missing = REQUIRED_PRIVY_VARS.filter((k) => !process.env[k]);
	if (missing.length > 0) {
		throw new Error(
			`Privy is required (no simulation). Missing: ${missing.join(", ")}. Run scripts/privy-setup.mjs first.`,
		);
	}

	// Goes through the MANDATORY factory (defaults to + requires privy).
	// No injected client -> the adapter builds the REAL @privy-io/node client.
	const cosigner = resolveStellarCosigner(process.env);
	const compassPublicKey = cosigner.getPublicKey();
	if (!compassPublicKey) {
		throw new Error("Privy cosigner not configured (real credentials required).");
	}
	console.log(`${INFO} Privy mode: REAL (mandatory). Compass (Privy) signer: ${compassPublicKey}`);

	const server = getHorizonServer();
	const user = Keypair.random();
	const destination = Keypair.random().publicKey();

	console.log(`${INFO} Funding user ${user.publicKey()} + destination via Friendbot...`);
	await fundTestnetAccount(user.publicKey());
	await fundTestnetAccount(destination);

	// Native multisig: user(1) + Compass/Privy(1) = threshold 2.
	const loaded = await server.loadAccount(user.publicKey());
	const setupXdr = buildMultisigSetupEnvelope({
		accountId: user.publicKey(),
		sequence: loaded.sequenceNumber(),
		compassSignerPublicKey: compassPublicKey,
		networkPassphrase: config.networkPassphrase,
	});
	const setupTx = TransactionBuilder.fromXDR(setupXdr, config.networkPassphrase);
	setupTx.sign(user);
	await server.submitTransaction(setupTx);
	const state = await cosigner.inspectAccount(user.publicKey());
	assertCompassRequired(state, compassPublicKey);
	console.log(`${PASS} Multisig set: Compass (Privy) is required (threshold ${state.threshold}).`);

	const buildUserSigned = async (amount) => {
		const account = await server.loadAccount(user.publicKey());
		const tx = new TransactionBuilder(account, {
			fee: "100",
			networkPassphrase: config.networkPassphrase,
		})
			.addOperation(
				Operation.payment({ destination, asset: Asset.native(), amount }),
			)
			.setTimeout(120)
			.build();
		tx.sign(user);
		return tx;
	};

	// CASE 1 — legit payment within policy -> ALLOW -> Privy co-signs -> executes.
	const tx1 = await buildUserSigned("50.0000000"); // ~$5 <= $10
	const guard1 = await runStellarGuard({
		envelopeXdr: tx1.toXDR(),
		policy: DEFAULT_POLICY,
		cosigner,
		knownRecipients: [destination],
		threshold: state.threshold,
		priorSignatureCount: 1,
	});
	let out1 = "not_submitted";
	if (guard1.cosign.signed) {
		try {
			await server.submitTransaction(
				TransactionBuilder.fromXDR(guard1.cosign.signedXdr, config.networkPassphrase),
			);
			out1 = "executable";
		} catch (e) {
			out1 = `rejected:${JSON.stringify(e?.response?.data?.extras?.result_codes ?? e.message)}`;
		}
	}
	console.log(
		`${out1 === "executable" ? PASS : FAIL} CASE 1 ALLOW: decision=${guard1.label}, Privy signed=${guard1.cosign.signed}, on-network=${out1}`,
	);

	// CASE 2 — amount out of range -> ESCALATE -> Privy does NOT sign -> rejected.
	const tx2 = await buildUserSigned("200.0000000"); // ~$20 > $10
	const guard2 = await runStellarGuard({
		envelopeXdr: tx2.toXDR(),
		policy: DEFAULT_POLICY,
		cosigner,
		knownRecipients: [destination],
		threshold: state.threshold,
		priorSignatureCount: 1,
	});
	let out2 = "not_submitted";
	if (!guard2.cosign.signed) {
		try {
			await server.submitTransaction(tx2); // user-only -> threshold unmet
			out2 = "executable"; // unexpected
		} catch (e) {
			out2 = `rejected:${JSON.stringify(e?.response?.data?.extras?.result_codes ?? "")}`;
		}
	}
	console.log(
		`${out2.startsWith("rejected") ? PASS : FAIL} CASE 2 ESCALATE: decision=${guard2.label}, Privy signed=${guard2.cosign.signed}, on-network=${out2}`,
	);

	const ok = out1 === "executable" && out2.startsWith("rejected");
	console.log(ok ? `\n${PASS} Modo B (Privy) verified on Testnet.` : `\n${FAIL} Unexpected outcome.`);
	process.exit(ok ? 0 : 1);
}

main().catch((e) => {
	console.error(`${FAIL} Demo failed:`, e?.message ?? e);
	process.exit(1);
});
