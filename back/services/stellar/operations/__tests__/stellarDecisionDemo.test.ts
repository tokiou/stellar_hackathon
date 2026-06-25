import { createActionCandidate } from "@back/guardrail/execution/executionGateway";
import type { SemanticFacts } from "@shared/chainContracts";
import {
	COMPASS_DECISIONS,
	type ToolClassification,
} from "@shared/executionGatewayContracts";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import { evaluateAction } from "@hosted/policy/policyEngine";
import { describe, expect, it } from "vitest";

import type { StellarDecodedOperation } from "../../transactions/stellarTransactionContracts";
import {
	deriveStellarAggregate,
	deriveStellarPolicyContext,
} from "../stellarPolicyContext";

const SOURCE = "GSOURCEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const DEST = "GDESTINATIONXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

/**
 * Runs a decoded Stellar envelope through the UNCHANGED policy engine, exactly
 * as the hosted evaluation flow would: aggregate -> classification + candidate,
 * derive context, evaluate.
 */
function decide(input: {
	facts: SemanticFacts;
	operations: StellarDecodedOperation[];
	knownRecipients?: string[];
}) {
	const aggregate = deriveStellarAggregate(input.operations);
	const context = deriveStellarPolicyContext({
		facts: input.facts,
		operations: input.operations,
		knownRecipients: input.knownRecipients,
	});
	const candidate = createActionCandidate({
		id: "demo",
		chain: "stellar",
		network: "testnet",
		toolName: "stellar_submit_transaction",
		actionKind: aggregate.actionKind,
		params: {},
	});
	const classification: ToolClassification = {
		toolName: "stellar_submit_transaction",
		riskClass: aggregate.riskClass,
		defaultDecision: aggregate.defaultDecision,
		auditRequired: true,
		reasonCodes: [],
	};
	return evaluateAction({
		candidate,
		classification,
		context,
		policy: DEFAULT_POLICY,
	});
}

function facts(amountUsd: number, recipient: string): SemanticFacts {
	return {
		actionKind: "transfer",
		sourceAddress: SOURCE,
		recipientAddress: recipient,
		asset: "XLM",
		amount: amountUsd * 10,
		amountUsd,
	};
}

const payment: StellarDecodedOperation = {
	index: 0,
	operationKind: "payment",
	rawType: "payment",
	recipientAddress: DEST,
	asset: { kind: "native", symbol: "XLM" },
	amount: "50.0000000",
};

describe("Stellar Wave 3 decision-only demo cases (unchanged policy engine)", () => {
	it("legit payment within policy -> ALLOW", () => {
		const result = decide({
			facts: facts(5, DEST),
			operations: [payment],
			knownRecipients: [DEST],
		});
		expect(result.decision).toBe(COMPASS_DECISIONS.ALLOW);
	});

	it("payment to a blocked/non-authorized destination -> DENY", () => {
		const result = decide({
			facts: facts(5, "known_bad_address"),
			operations: [
				{ ...payment, recipientAddress: "known_bad_address" },
			],
			knownRecipients: ["known_bad_address"],
		});
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
	});

	it("amount out of range -> ESCALATE (REQUIRE_HUMAN_APPROVAL)", () => {
		const result = decide({
			facts: facts(20, DEST),
			operations: [payment],
			knownRecipients: [DEST],
		});
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
	});

	it("critical op (setOptions / changeTrust present) -> ESCALATE", () => {
		const result = decide({
			facts: facts(5, DEST),
			operations: [
				payment,
				{ index: 1, operationKind: "other", rawType: "setOptions" },
			],
			knownRecipients: [DEST],
		});
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
	});

	it("changeTrust-only envelope -> ESCALATE", () => {
		const result = decide({
			facts: {
				actionKind: "other",
				sourceAddress: SOURCE,
				recipientAddress: "",
				asset: "",
				amount: 0,
				amountUsd: 0,
			},
			operations: [{ index: 0, operationKind: "other", rawType: "changeTrust" }],
		});
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
	});
});
