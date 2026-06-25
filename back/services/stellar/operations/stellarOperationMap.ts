import {
	COMPASS_DECISIONS,
	TOOL_RISK_CLASSES,
	type CompassDecision,
	type ToolRiskClass,
} from "@shared/executionGatewayContracts";

/**
 * Stellar operation → Compass vocabulary mapping (Stellar Wave 3).
 *
 * Pure, side-effect-free. It translates a decoded Stellar operation type into
 * the `actionKind` + `riskClass` the EXISTING policy engine already understands,
 * plus a `critical` flag and additive context flags. The engine still makes the
 * decision — this layer only feeds it.
 *
 * Engine-aware design note: value-movement operations map to `actionKind:
 * "transfer"` so the engine evaluates amount/recipient (ALLOW/DENY/ESCALATE).
 * Critical configuration operations map to `actionKind: "account_management"`,
 * which the unchanged engine routes to `policy.default` (= require_approval),
 * forcing REQUIRE_HUMAN_APPROVAL (ESCALATE) WITHOUT any engine change.
 */

export const STELLAR_TRANSFER_ACTION_KIND = "transfer";
export const STELLAR_ACCOUNT_MANAGEMENT_ACTION_KIND = "account_management";
export const STELLAR_UNKNOWN_ACTION_KIND = "unknown";

export type StellarContextFlags = {
	changes_trustline?: boolean;
	changes_signers?: boolean;
};

export type StellarOperationMapping = {
	actionKind: string;
	riskClass: ToolRiskClass;
	critical: boolean;
	contextFlags?: StellarContextFlags;
};

const VALUE_TRANSFER: StellarOperationMapping = {
	actionKind: STELLAR_TRANSFER_ACTION_KIND,
	riskClass: TOOL_RISK_CLASSES.SENSITIVE_EXECUTION,
	critical: false,
};

function criticalAccountOp(
	contextFlags?: StellarContextFlags,
): StellarOperationMapping {
	return {
		actionKind: STELLAR_ACCOUNT_MANAGEMENT_ACTION_KIND,
		riskClass: TOOL_RISK_CLASSES.SENSITIVE_EXECUTION,
		critical: true,
		contextFlags,
	};
}

/** Fail-closed mapping for unmapped/future operation types. */
export const STELLAR_FAIL_CLOSED_MAPPING: StellarOperationMapping = {
	actionKind: STELLAR_UNKNOWN_ACTION_KIND,
	riskClass: TOOL_RISK_CLASSES.BLOCKED_UNKNOWN,
	critical: true,
};

const OPERATION_MAP: Record<string, StellarOperationMapping> = {
	payment: VALUE_TRANSFER,
	pathPaymentStrictSend: VALUE_TRANSFER,
	pathPaymentStrictReceive: VALUE_TRANSFER,
	createAccount: VALUE_TRANSFER,
	changeTrust: criticalAccountOp({ changes_trustline: true }),
	setOptions: criticalAccountOp({ changes_signers: true }),
	manageData: criticalAccountOp(),
	manageSellOffer: criticalAccountOp(),
	manageBuyOffer: criticalAccountOp(),
};

export function mapStellarOperation(opType: string): StellarOperationMapping {
	return OPERATION_MAP[opType] ?? STELLAR_FAIL_CLOSED_MAPPING;
}

export type StellarEnvelopeAggregate = {
	actionKind: string;
	riskClass: ToolRiskClass;
	/** Never DENY — the engine only special-cases DENY classifications. */
	defaultDecision: CompassDecision;
	critical: boolean;
	contextFlags: StellarContextFlags;
};

/**
 * Aggregates an envelope's operations into a single classification. If ANY
 * operation is critical the whole envelope escalates as a unit; an unmapped
 * operation forces the fail-closed BLOCKED_UNKNOWN path.
 */
export function aggregateStellarOperations(
	opTypes: string[],
): StellarEnvelopeAggregate {
	const mappings = opTypes.map(mapStellarOperation);

	const contextFlags: StellarContextFlags = {};
	for (const mapping of mappings) {
		if (mapping.contextFlags?.changes_trustline) {
			contextFlags.changes_trustline = true;
		}
		if (mapping.contextFlags?.changes_signers) {
			contextFlags.changes_signers = true;
		}
	}

	const anyUnknown = mappings.some(
		(mapping) => mapping.riskClass === TOOL_RISK_CLASSES.BLOCKED_UNKNOWN,
	);
	const anyCritical = mappings.some((mapping) => mapping.critical);
	const valueOp = mappings.find(
		(mapping) => mapping.actionKind === STELLAR_TRANSFER_ACTION_KIND,
	);

	if (anyUnknown) {
		return {
			actionKind: STELLAR_UNKNOWN_ACTION_KIND,
			riskClass: TOOL_RISK_CLASSES.BLOCKED_UNKNOWN,
			defaultDecision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			critical: true,
			contextFlags,
		};
	}

	if (anyCritical) {
		return {
			actionKind: STELLAR_ACCOUNT_MANAGEMENT_ACTION_KIND,
			riskClass: TOOL_RISK_CLASSES.SENSITIVE_EXECUTION,
			defaultDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			critical: true,
			contextFlags,
		};
	}

	if (valueOp) {
		return {
			actionKind: STELLAR_TRANSFER_ACTION_KIND,
			riskClass: TOOL_RISK_CLASSES.SENSITIVE_EXECUTION,
			defaultDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			critical: false,
			contextFlags,
		};
	}

	return {
		actionKind: STELLAR_UNKNOWN_ACTION_KIND,
		riskClass: TOOL_RISK_CLASSES.BLOCKED_UNKNOWN,
		defaultDecision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		critical: true,
		contextFlags,
	};
}
