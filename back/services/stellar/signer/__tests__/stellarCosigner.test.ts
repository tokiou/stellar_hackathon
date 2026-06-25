import { readFileSync } from "node:fs";
import path from "node:path";

import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { COMPASS_DECISIONS } from "@shared/executionGatewayContracts";
import { describe, expect, it } from "vitest";

import {
	createStellarCosigner,
	hashStellarEnvelope,
	inspectStellarAccount,
	meetsThreshold,
} from "../stellarCosigner";

const USER = Keypair.random();
const COMPASS = Keypair.random();

function userSignedEnvelope(): string {
	const account = new Account(USER.publicKey(), "100");
	const tx = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: Networks.TESTNET,
	})
		.addOperation(
			Operation.payment({
				destination: Keypair.random().publicKey(),
				asset: Asset.native(),
				amount: "1.0000000",
			}),
		)
		.setTimeout(60)
		.build();
	tx.sign(USER);
	return tx.toXDR();
}

function enabledEnv(
	overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
		COMPASS_STELLAR_SIGNER_ENABLED: "true",
		COMPASS_STELLAR_SIGNER_SECRET: COMPASS.secret(),
		...overrides,
	};
}

function countSignatures(xdr: string): number {
	return TransactionBuilder.fromXDR(xdr, Networks.TESTNET).signatures.length;
}

describe("createStellarCosigner.cosign", () => {
	it("adds ONLY Compass's signature on ALLOW, never submits", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const envelope = userSignedEnvelope();

		const result = await cosigner.cosign({
			envelopeXdr: envelope,
			decision: COMPASS_DECISIONS.ALLOW,
		});

		expect(result.signed).toBe(true);
		if (!result.signed) return;
		expect(result.signerPublicKey).toBe(COMPASS.publicKey());
		// user sig (1) + compass sig (1) = 2, and Compass's hint is present.
		expect(countSignatures(result.signedXdr)).toBe(2);
		const reparsed = TransactionBuilder.fromXDR(
			result.signedXdr,
			Networks.TESTNET,
		);
		expect(
			reparsed.signatures.some((sig) =>
				sig.hint().equals(COMPASS.signatureHint()),
			),
		).toBe(true);
	});

	it("refuses to sign on DENY (POLICY_NOT_ALLOWED), adds no signature", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.DENY,
		});
		expect(result).toEqual({ signed: false, reason: "POLICY_NOT_ALLOWED" });
	});

	it("refuses on unresolved REQUIRE_HUMAN_APPROVAL", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
		});
		expect(result).toMatchObject({ signed: false, reason: "POLICY_NOT_ALLOWED" });
	});

	it("enforces envelope-to-candidate binding", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
			expectedEnvelopeFingerprint: "deadbeef-not-the-real-hash",
		});
		expect(result).toMatchObject({
			signed: false,
			reason: "ENVELOPE_CANDIDATE_MISMATCH",
		});
	});

	it("signs when the binding fingerprint matches", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const envelope = userSignedEnvelope();
		const result = await cosigner.cosign({
			envelopeXdr: envelope,
			decision: COMPASS_DECISIONS.ALLOW,
			expectedEnvelopeFingerprint: hashStellarEnvelope(envelope),
		});
		expect(result.signed).toBe(true);
	});

	it("returns COMPASS_SIGNER_NOT_CONFIGURED when disabled", async () => {
		const cosigner = createStellarCosigner({
			env: { STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET },
		});
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(result).toMatchObject({
			signed: false,
			reason: "COMPASS_SIGNER_NOT_CONFIGURED",
		});
	});

	it("returns COMPASS_SIGNER_MAINNET_FORBIDDEN for a mainnet passphrase", async () => {
		const cosigner = createStellarCosigner({
			env: enabledEnv({ STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC }),
		});
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(result).toMatchObject({
			signed: false,
			reason: "COMPASS_SIGNER_MAINNET_FORBIDDEN",
		});
	});

	it("never leaks the Compass secret seed in the result", async () => {
		const cosigner = createStellarCosigner({ env: enabledEnv() });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(JSON.stringify(result)).not.toContain(COMPASS.secret());
	});
});

describe("inspectStellarAccount + meetsThreshold (multisig thesis)", () => {
	const account = {
		signers: [
			{ key: USER.publicKey(), weight: 1 },
			{ key: COMPASS.publicKey(), weight: 1 },
		],
		thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 2 },
	};

	it("reads signers and the medium threshold from Horizon", async () => {
		const state = await inspectStellarAccount(USER.publicKey(), {
			loadAccount: async () => account,
		});
		expect(state.exists).toBe(true);
		expect(state.signers).toEqual([USER.publicKey(), COMPASS.publicKey()]);
		expect(state.threshold).toBe(2);
	});

	it("without Compass's signature the threshold is unmet; with it, met", () => {
		expect(meetsThreshold(1, account.thresholds.med_threshold)).toBe(false);
		expect(meetsThreshold(2, account.thresholds.med_threshold)).toBe(true);
	});

	it("reports a non-existent account as not existing", async () => {
		const state = await inspectStellarAccount("GMISSING", {
			loadAccount: async () => {
				throw new Error("404");
			},
		});
		expect(state.exists).toBe(false);
	});
});

describe("no legacy imports in Wave 4 files", () => {
	it("signer files do not import from legacy/", () => {
		for (const rel of ["stellarCosigner.ts", "stellarCosignerContracts.ts"]) {
			const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
			expect(source).not.toMatch(/legacy\//);
		}
	});
});
