import { createActionCandidate } from "@back/guardrail/execution/executionGateway";
import {
	COMPASS_DECISIONS,
	type CompassDecision,
	type ToolClassification,
} from "@shared/executionGatewayContracts";
import type { CompassPolicy } from "@shared/policyContracts";
import { evaluateAction } from "@hosted/policy/policyEngine";

import { buildStellarAuditMetadata, type StellarAuditFields } from "../audit/stellarAuditMetadata";
import {
	deriveStellarAggregate,
	deriveStellarPolicyContext,
} from "../operations/stellarPolicyContext";
import type {
	CompassStellarCosigner,
	CosignResult,
} from "../signer/stellarCosignerContracts";
import { StellarChainAdapter } from "../stellarChainAdapter";
import { decodeStellarEnvelope } from "../transactions/stellarTransactionDecoder";

/**
 * Stellar guard pipeline (Stellar Wave 6) — composes Waves 1–5 into the single
 * flow the demo and the MCP proxy drive: decode (W2) -> operation map/context
 * (W3) -> the UNCHANGED brain (policy engine) -> policy-gated co-sign (W4) ->
 * audit metadata (W5). It introduces no new decision logic; it only wires the
 * existing pieces together so the decision/co-sign/audit are produced as a unit.
 */

const STELLAR_TOOL_NAME = "stellar_submit_transaction";
const STELLAR_NETWORK = "testnet";

export type StellarGuardLabel = "ALLOW" | "DENY" | "ESCALATE";

export type StellarGuardInput = {
	envelopeXdr: string;
	policy: CompassPolicy;
	cosigner: CompassStellarCosigner;
	knownRecipients?: string[];
	/** Account medium threshold (required signers); weight-1 multisig. */
	threshold?: number;
	/** Signatures already present on the envelope (e.g. the user's). */
	priorSignatureCount?: number;
	/** Injectable for tests; defaults to the real brain. */
	evaluatePolicy?: typeof evaluateAction;
};

export type StellarGuardResult = {
	label: StellarGuardLabel;
	decision: CompassDecision;
	reasons: string[];
	cosign: CosignResult;
	audit: StellarAuditFields;
};

export function toGuardLabel(decision: CompassDecision): StellarGuardLabel {
	if (decision === COMPASS_DECISIONS.ALLOW) {
		return "ALLOW";
	}
	if (decision === COMPASS_DECISIONS.DENY) {
		return "DENY";
	}
	return "ESCALATE";
}

export async function runStellarGuard(
	input: StellarGuardInput,
): Promise<StellarGuardResult> {
	const evaluatePolicy = input.evaluatePolicy ?? evaluateAction;

	const decoded = await decodeStellarEnvelope(input.envelopeXdr);
	if (!decoded.ok) {
		const failure = decoded as { reason: string; message: string };
		throw new Error(`STELLAR_DECODE_${failure.reason}: ${failure.message}`);
	}
	const { facts, operations } = decoded;

	const aggregate = deriveStellarAggregate(operations);
	const context = deriveStellarPolicyContext({
		facts,
		operations,
		knownRecipients: input.knownRecipients,
	});
	const candidate = createActionCandidate({
		id: "stellar-guard",
		chain: "stellar",
		network: STELLAR_NETWORK,
		toolName: STELLAR_TOOL_NAME,
		actionKind: aggregate.actionKind,
		params: {},
	});
	const classification: ToolClassification = {
		toolName: STELLAR_TOOL_NAME,
		riskClass: aggregate.riskClass,
		defaultDecision: aggregate.defaultDecision,
		auditRequired: true,
		reasonCodes: [],
	};

	const evaluation = evaluatePolicy({
		candidate,
		classification,
		context,
		policy: input.policy,
	});
	const label = toGuardLabel(evaluation.decision);

	const cosign: CosignResult =
		label === "ALLOW"
			? await input.cosigner.cosign({
					envelopeXdr: input.envelopeXdr,
					decision: evaluation.decision,
				})
			: { signed: false, reason: "POLICY_NOT_ALLOWED" };

	const cosigned = cosign.signed === true;
	const threshold = input.threshold ?? 0;
	const collectedSigners = (input.priorSignatureCount ?? 0) + (cosigned ? 1 : 0);

	const adapter = new StellarChainAdapter();
	const audit = buildStellarAuditMetadata(adapter.buildAuditMetadata(facts), {
		cosigned,
		denied: label === "DENY",
		requiredSigners: threshold,
		collectedSigners,
		threshold,
	});

	return {
		label,
		decision: evaluation.decision,
		reasons: evaluation.reasonCodes,
		cosign,
		audit,
	};
}
