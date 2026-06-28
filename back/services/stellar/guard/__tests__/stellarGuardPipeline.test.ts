import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
	xdr,
} from "@stellar/stellar-sdk";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import { describe, expect, it } from "vitest";

import { createStellarCosigner } from "../../signer/stellarCosigner";
import { runStellarGuard } from "../stellarGuardPipeline";

const USER = Keypair.random();
const COMPASS = Keypair.random();
const DEST = Keypair.random().publicKey();

function userSignedEnvelope(operations: xdr.Operation[]): string {
	const account = new Account(USER.publicKey(), "100");
	let builder = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: Networks.TESTNET,
	});
	for (const op of operations) {
		builder = builder.addOperation(op);
	}
	const tx = builder.setTimeout(120).build();
	tx.sign(USER); // the "user" signature is already present
	return tx.toXDR();
}

function payment(destination: string, amount: string): xdr.Operation {
	return Operation.payment({
		destination,
		asset: Asset.native(),
		amount,
	});
}

const cosigner = createStellarCosigner({
	env: {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
		COMPASS_STELLAR_SIGNER_ENABLED: "true",
		COMPASS_STELLAR_SIGNER_SECRET: COMPASS.secret(),
		FALLBACK_XLM_USD_PRICE: "0.1",
	},
});

function guard(input: {
	operations: xdr.Operation[];
	knownRecipients?: string[];
}) {
	return runStellarGuard({
		envelopeXdr: userSignedEnvelope(input.operations),
		policy: DEFAULT_POLICY,
		cosigner,
		knownRecipients: input.knownRecipients,
		threshold: 2,
		priorSignatureCount: 1, // the user already signed
	});
}

describe("runStellarGuard — end-to-end Stellar guard flow (Waves 1-5)", () => {
	it("ALLOW within policy -> Compass co-signs; audit COSIGNED_BY_COMPASS, 2/2", async () => {
		// 50 XLM * 0.1 = $5 <= $10 limit, known recipient.
		const result = await guard({
			operations: [payment(DEST, "50.0000000")],
			knownRecipients: [DEST],
		});
		expect(result.label).toBe("ALLOW");
		expect(result.cosign.signed).toBe(true);
		expect(result.audit.lifecycle).toBe("COSIGNED_BY_COMPASS");
		expect(result.audit.collectedSigners).toBe(2);
		expect(result.audit.requiredSigners).toBe(2);
	});

	it("DENY on blocked recipient -> no co-sign; audit DENIED, 1/2 (not executable)", async () => {
		const policyWithBlock = {
			...DEFAULT_POLICY,
			transfers: { ...DEFAULT_POLICY.transfers, blocked_recipients: [DEST] },
		};
		const result = await runStellarGuard({
			envelopeXdr: userSignedEnvelope([payment(DEST, "5.0000000")]),
			policy: policyWithBlock,
			cosigner,
			knownRecipients: [DEST],
			threshold: 2,
			priorSignatureCount: 1,
		});
		expect(result.label).toBe("DENY");
		expect(result.cosign.signed).toBe(false);
		expect(result.audit.lifecycle).toBe("DENIED");
		expect(result.audit.collectedSigners).toBe(1);
		expect(result.audit.requiredSigners).toBe(2);
	});

	it("amount out of range -> ESCALATE; no co-sign; 1/2", async () => {
		// 200 XLM * 0.1 = $20 > $10 limit.
		const result = await guard({
			operations: [payment(DEST, "200.0000000")],
			knownRecipients: [DEST],
		});
		expect(result.label).toBe("ESCALATE");
		expect(result.cosign.signed).toBe(false);
		expect(result.audit.collectedSigners).toBe(1);
		expect(result.audit.threshold).toBe(2);
	});

	it("critical op (setOptions present) -> ESCALATE; no co-sign", async () => {
		const result = await guard({
			operations: [
				payment(DEST, "5.0000000"),
				Operation.setOptions({ homeDomain: "example.com" }),
			],
			knownRecipients: [DEST],
		});
		expect(result.label).toBe("ESCALATE");
		expect(result.cosign.signed).toBe(false);
	});
});
