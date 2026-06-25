import { readFileSync } from "node:fs";
import path from "node:path";

import { TOOL_RISK_CLASSES } from "@shared/executionGatewayContracts";
import { describe, expect, it } from "vitest";

import {
	aggregateStellarOperations,
	mapStellarOperation,
} from "../stellarOperationMap";

describe("mapStellarOperation", () => {
	it("maps value-movement operations to transfer / SENSITIVE_EXECUTION, non-critical", () => {
		for (const type of [
			"payment",
			"pathPaymentStrictSend",
			"pathPaymentStrictReceive",
			"createAccount",
		]) {
			const mapping = mapStellarOperation(type);
			expect(mapping.actionKind).toBe("transfer");
			expect(mapping.riskClass).toBe(TOOL_RISK_CLASSES.SENSITIVE_EXECUTION);
			expect(mapping.critical).toBe(false);
		}
	});

	it("marks changeTrust critical with changes_trustline flag", () => {
		const mapping = mapStellarOperation("changeTrust");
		expect(mapping.critical).toBe(true);
		expect(mapping.contextFlags?.changes_trustline).toBe(true);
	});

	it("marks setOptions critical with changes_signers flag", () => {
		const mapping = mapStellarOperation("setOptions");
		expect(mapping.critical).toBe(true);
		expect(mapping.contextFlags?.changes_signers).toBe(true);
	});

	it("treats manage* operations as critical (conservative)", () => {
		for (const type of ["manageData", "manageSellOffer", "manageBuyOffer"]) {
			expect(mapStellarOperation(type).critical).toBe(true);
		}
	});

	it("fails closed for unmapped/future operation types", () => {
		const mapping = mapStellarOperation("someFutureOp");
		expect(mapping.riskClass).toBe(TOOL_RISK_CLASSES.BLOCKED_UNKNOWN);
		expect(mapping.critical).toBe(true);
	});
});

describe("aggregateStellarOperations", () => {
	it("a single payment aggregates to a non-critical transfer", () => {
		const aggregate = aggregateStellarOperations(["payment"]);
		expect(aggregate.actionKind).toBe("transfer");
		expect(aggregate.critical).toBe(false);
	});

	it("escalates the whole envelope if any operation is critical", () => {
		const aggregate = aggregateStellarOperations(["payment", "setOptions"]);
		expect(aggregate.critical).toBe(true);
		expect(aggregate.actionKind).toBe("account_management");
		expect(aggregate.contextFlags.changes_signers).toBe(true);
	});

	it("merges additive flags across operations", () => {
		const aggregate = aggregateStellarOperations(["changeTrust", "setOptions"]);
		expect(aggregate.contextFlags.changes_trustline).toBe(true);
		expect(aggregate.contextFlags.changes_signers).toBe(true);
	});

	it("an unmapped operation forces the fail-closed BLOCKED_UNKNOWN path", () => {
		const aggregate = aggregateStellarOperations(["payment", "mysteryOp"]);
		expect(aggregate.riskClass).toBe(TOOL_RISK_CLASSES.BLOCKED_UNKNOWN);
		expect(aggregate.actionKind).toBe("unknown");
	});
});

describe("no legacy imports in Wave 3 files", () => {
	it("new operation files do not import from legacy/", () => {
		for (const rel of ["stellarOperationMap.ts", "stellarPolicyContext.ts"]) {
			const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
			expect(source).not.toMatch(/legacy\//);
		}
	});
});
