import type { SemanticFacts } from "@shared/chainContracts";
import { describe, expect, it } from "vitest";

import type { StellarDecodedOperation } from "../../transactions/stellarTransactionContracts";
import { deriveStellarPolicyContext } from "../stellarPolicyContext";

const DEST = "GDESTINATIONXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

function paymentFacts(amountUsd: number, recipient = DEST): SemanticFacts {
	return {
		actionKind: "transfer",
		sourceAddress: "GSOURCEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
		recipientAddress: recipient,
		asset: "XLM",
		amount: 100,
		amountUsd,
	};
}

function op(rawType: string): StellarDecodedOperation {
	return { index: 0, operationKind: "other", rawType };
}

describe("deriveStellarPolicyContext", () => {
	it("derives amount_usd, recipient_address, recipient_known from a payment", () => {
		const context = deriveStellarPolicyContext({
			facts: paymentFacts(5),
			operations: [{ index: 0, operationKind: "payment", rawType: "payment" }],
			knownRecipients: [DEST],
		});
		expect(context.amount_usd).toBe(5);
		expect(context.recipient_address).toBe(DEST);
		expect(context.recipient_known).toBe(true);
	});

	it("marks recipient_known false when not in the allowlist", () => {
		const context = deriveStellarPolicyContext({
			facts: paymentFacts(5),
			operations: [{ index: 0, operationKind: "payment", rawType: "payment" }],
			knownRecipients: [],
		});
		expect(context.recipient_known).toBe(false);
	});

	it("sets changes_signers for setOptions and preserves pre-existing flags", () => {
		const context = deriveStellarPolicyContext({
			facts: paymentFacts(5),
			operations: [op("setOptions")],
			baseFlags: { suspicious_recipient: true },
		});
		expect(context.flags?.changes_signers).toBe(true);
		expect(context.flags?.suspicious_recipient).toBe(true);
		expect(context.flags?.changes_trustline).toBeUndefined();
	});

	it("sets changes_trustline for changeTrust", () => {
		const context = deriveStellarPolicyContext({
			facts: paymentFacts(5),
			operations: [op("changeTrust")],
		});
		expect(context.flags?.changes_trustline).toBe(true);
	});
});
