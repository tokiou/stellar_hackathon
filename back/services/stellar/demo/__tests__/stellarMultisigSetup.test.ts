import {
	Keypair,
	Networks,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { AccountSignerState } from "@shared/chainContracts";
import { describe, expect, it } from "vitest";

import {
	assertCompassRequired,
	buildMultisigSetupEnvelope,
	isCompassRequired,
} from "../stellarMultisigSetup";

const USER = Keypair.random();
const COMPASS = Keypair.random();

describe("buildMultisigSetupEnvelope", () => {
	it("builds a setOptions tx adding Compass as a weight-1 signer with threshold 2", () => {
		const xdr = buildMultisigSetupEnvelope({
			accountId: USER.publicKey(),
			sequence: "100",
			compassSignerPublicKey: COMPASS.publicKey(),
		});

		const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
		expect(tx.operations).toHaveLength(1);
		const op = tx.operations[0];
		expect(op?.type).toBe("setOptions");
		if (op?.type !== "setOptions") return;
		expect(op.masterWeight).toBe(1);
		expect(op.medThreshold).toBe(2);
		expect(op.highThreshold).toBe(2);
		expect(op.signer).toBeDefined();
		expect(JSON.stringify(op.signer)).toContain(COMPASS.publicKey());
	});
});

describe("isCompassRequired / assertCompassRequired", () => {
	const required: AccountSignerState = {
		address: USER.publicKey(),
		exists: true,
		signers: [USER.publicKey(), COMPASS.publicKey()],
		threshold: 2,
	};

	it("is true when Compass is a signer and threshold >= 2 (no single signer suffices)", () => {
		expect(isCompassRequired(required, COMPASS.publicKey())).toBe(true);
	});

	it("is false when threshold is 1 (a single signer would suffice)", () => {
		expect(
			isCompassRequired({ ...required, threshold: 1 }, COMPASS.publicKey()),
		).toBe(false);
	});

	it("is false when Compass is not among the signers", () => {
		expect(
			isCompassRequired(
				{ ...required, signers: [USER.publicKey()] },
				COMPASS.publicKey(),
			),
		).toBe(false);
	});

	it("is false for a non-existent account", () => {
		expect(
			isCompassRequired(
				{ address: USER.publicKey(), exists: false },
				COMPASS.publicKey(),
			),
		).toBe(false);
	});

	it("assertCompassRequired throws a clear error when Compass is not required", () => {
		expect(() =>
			assertCompassRequired({ ...required, threshold: 1 }, COMPASS.publicKey()),
		).toThrow(/STELLAR_DEMO_COMPASS_NOT_REQUIRED/);
	});
});
