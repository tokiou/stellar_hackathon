#!/usr/bin/env node
/**
 * Stellar Wave 6 — reproducible Testnet demo orchestrator.
 *
 * Drives the Wave 1–5 Stellar primitives end-to-end on the public Testnet:
 *   1. create + fund a fresh account via Friendbot (Wave 1)
 *   2. configure native multisig so Compass is a REQUIRED co-signer (Wave 4/6)
 *   3. run the six demo cases through the guard pipeline (Waves 2–5) and submit
 *   4. print a verdict table + per-case audit summary
 *
 * No custom on-chain contract — the multisig guarantee is native Stellar.
 *
 * Run with tsx (it resolves the TS modules + tsconfig path aliases):
 *   COMPASS_STELLAR_SIGNER_ENABLED=true \
 *   COMPASS_STELLAR_SIGNER_SECRET=S... \
 *   STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
 *   npx tsx scripts/stellar-demo.mjs
 *
 * See docs/stellar-wave-6-demo-and-testnet-setup/runbook.md for full steps.
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
import {
	getHorizonServer,
} from "../back/services/stellar/providers/stellarConnection";
import { getStellarNetworkConfig } from "../back/services/stellar/providers/stellarNetworkConfig";
import { createStellarCosigner } from "../back/services/stellar/signer/stellarCosigner";
import {
	assertCompassRequired,
	buildMultisigSetupEnvelope,
} from "../back/services/stellar/demo/stellarMultisigSetup";
import { runStellarGuard } from "../back/services/stellar/demo/stellarGuardPipeline";
import { DEFAULT_POLICY } from "../hosted/policy/defaultPolicy";
import { DEMO_CASES } from "./stellar-demo-cases.mjs";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36m→\x1b[0m";

function log(msg) {
	console.log(msg);
}

async function main() {
	const config = getStellarNetworkConfig();
	const cosigner = createStellarCosigner();
	const compassPublicKey = cosigner.getPublicKey();
	if (!compassPublicKey) {
		throw new Error(
			"Compass signer is not configured. Set COMPASS_STELLAR_SIGNER_ENABLED=true and COMPASS_STELLAR_SIGNER_SECRET (testnet).",
		);
	}

	const server = getHorizonServer();
	const user = Keypair.random();
	const destination = Keypair.random().publicKey();
	const blockedDestination = Keypair.random().publicKey();

	// Demo policy: block the "non-authorized" destination so case 2 is a real DENY.
	const policy = {
		...DEFAULT_POLICY,
		transfers: {
			...DEFAULT_POLICY.transfers,
			blocked_recipients: [blockedDestination],
		},
	};

	// 1. Create + fund the user/master account via Friendbot. The payment
	// destination must also exist on the ledger, or `payment` fails with
	// op_no_destination — so fund it too.
	log(`${INFO} Funding ${user.publicKey()} via Friendbot...`);
	await fundTestnetAccount(user.publicKey());
	log(`${INFO} Funding destination ${destination} via Friendbot...`);
	await fundTestnetAccount(destination);

	// 2. Configure native multisig (master weight 1 + Compass weight 1, threshold 2).
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
	log(`${INFO} Multisig configured (master + Compass = threshold 2).`);

	// Verify Compass is genuinely required before running any case.
	const state = await cosigner.inspectAccount(user.publicKey());
	assertCompassRequired(state, compassPublicKey);
	log(`${PASS} Compass is a required signer (threshold ${state.threshold}).`);

	const ctx = {
		Operation,
		Asset,
		accountId: user.publicKey(),
		userPublicKey: user.publicKey(),
		destination,
		blockedDestination,
	};

	const results = [];
	for (const demo of DEMO_CASES) {
		const account = await server.loadAccount(user.publicKey());
		let builder = new TransactionBuilder(account, {
			fee: "100",
			networkPassphrase: config.networkPassphrase,
		});
		for (const op of demo.buildOps(ctx)) {
			builder = builder.addOperation(op);
		}
		const tx = builder.setTimeout(120).build();
		if (demo.userSigns) {
			tx.sign(user);
		}
		const envelopeXdr = tx.toXDR();

		const guard = await runStellarGuard({
			envelopeXdr,
			policy,
			cosigner,
			knownRecipients: demo.knownRecipient ? [destination] : [],
			threshold: state.threshold,
			priorSignatureCount: demo.userSigns ? 1 : 0,
		});

		const resultCodes = (error) =>
			JSON.stringify(error?.response?.data?.extras?.result_codes ?? error?.message ?? "unknown");

		let observedOutcome = "not_submitted";
		let submitDetail = "";
		if (guard.cosign.signed) {
			try {
				const finalTx = TransactionBuilder.fromXDR(
					guard.cosign.signedXdr,
					config.networkPassphrase,
				);
				await server.submitTransaction(finalTx);
				observedOutcome = "executable";
			} catch (error) {
				observedOutcome = "not_executable";
				submitDetail = resultCodes(error);
			}
		} else if (demo.submitWithoutCompass) {
			// Prove non-executability: submit with only the user's signature.
			try {
				await server.submitTransaction(tx);
				observedOutcome = "executable"; // unexpected — would fail the case
			} catch (error) {
				observedOutcome = "not_executable";
				submitDetail = resultCodes(error);
			}
		}

		const matched =
			guard.label === demo.expectedDecision &&
			observedOutcome === demo.expectedOutcome;
		results.push({
			id: demo.id,
			title: demo.title,
			decision: guard.label,
			expectedDecision: demo.expectedDecision,
			observedOutcome,
			expectedOutcome: demo.expectedOutcome,
			matched,
			audit: guard.audit,
			submitDetail,
		});
	}

	log("\nVerdict table:");
	for (const r of results) {
		const mark = r.matched ? PASS : FAIL;
		log(
			`  ${mark} case ${r.id}: ${r.title} — decision ${r.decision} (exp ${r.expectedDecision}), outcome ${r.observedOutcome} (exp ${r.expectedOutcome}); audit ${r.audit.lifecycle} ${r.audit.collectedSigners}/${r.audit.requiredSigners}${r.submitDetail ? ` [${r.submitDetail}]` : ""}`,
		);
	}

	const failures = results.filter((r) => !r.matched);
	if (failures.length > 0) {
		log(`\n${FAIL} ${failures.length} case(s) did not match expectations.`);
		process.exit(1);
	}
	log(`\n${PASS} All six demo cases matched expectations.`);
}

main().catch((error) => {
	console.error(`${FAIL} Demo failed:`, error.message ?? error);
	process.exit(1);
});
