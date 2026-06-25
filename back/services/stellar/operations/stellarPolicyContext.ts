import type { SemanticFacts } from "@shared/chainContracts";
import type { PolicyEvaluationContext } from "@shared/policyContracts";

import type { StellarDecodedOperation } from "../transactions/stellarTransactionContracts";
import {
	aggregateStellarOperations,
	type StellarEnvelopeAggregate,
} from "./stellarOperationMap";

export type DeriveStellarPolicyContextInput = {
	/** Wave 2 decode output. */
	facts: SemanticFacts;
	operations: StellarDecodedOperation[];
	/** Allowlist signal the engine consumes as `recipient_known`. */
	knownRecipients?: string[];
	/** Pre-existing flags to preserve (e.g. from upstream signals). */
	baseFlags?: PolicyEvaluationContext["flags"];
};

/**
 * Builds the `PolicyEvaluationContext` the EXISTING engine consumes from a
 * decoded Stellar envelope (Stellar Wave 3). Additive only: it spreads any
 * pre-existing flags and ORs in the Stellar descriptive flags; it never removes
 * or renames existing fields.
 */
export function deriveStellarPolicyContext(
	input: DeriveStellarPolicyContextInput,
): PolicyEvaluationContext {
	const { facts, operations, knownRecipients = [], baseFlags } = input;
	const aggregate = aggregateStellarOperations(
		operations.map((operation) => operation.rawType),
	);

	const recipientAddress = facts.recipientAddress || undefined;
	const recipientKnown = recipientAddress
		? knownRecipients.includes(recipientAddress)
		: false;

	const flags: NonNullable<PolicyEvaluationContext["flags"]> = {
		...(baseFlags ?? {}),
	};
	if (aggregate.contextFlags.changes_trustline) {
		flags.changes_trustline = true;
	}
	if (aggregate.contextFlags.changes_signers) {
		flags.changes_signers = true;
	}

	return {
		amount_usd: facts.amountUsd,
		recipient_address: recipientAddress,
		recipient_known: recipientKnown,
		flags,
	};
}

/** Convenience: the envelope-level classification inputs for the engine. */
export function deriveStellarAggregate(
	operations: StellarDecodedOperation[],
): StellarEnvelopeAggregate {
	return aggregateStellarOperations(
		operations.map((operation) => operation.rawType),
	);
}
