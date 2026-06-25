import { readFileSync } from "node:fs";
import path from "node:path";

import type { ChainAuditMetadata } from "@shared/chainContracts";
import { describe, expect, it } from "vitest";

import {
	buildStellarAuditMetadata,
	type StellarCoSigningResult,
} from "../stellarAuditMetadata";

const META: ChainAuditMetadata = {
	chainId: "stellar",
	network: "testnet",
	actionKind: "transfer",
	sourceAddress: "GSOURCE",
	recipientAddress: "GDEST",
	asset: "XLM",
	amount: 50,
};

describe("buildStellarAuditMetadata", () => {
	it("records chain/network/semantic facts from ChainAuditMetadata", () => {
		const fields = buildStellarAuditMetadata(META, {
			cosigned: true,
			requiredSigners: 2,
			collectedSigners: 2,
			threshold: 2,
			txHash: "abc123",
		});
		expect(fields.chain).toBe("stellar");
		expect(fields.network).toBe("testnet");
		expect(fields.sourceAccount).toBe("GSOURCE");
		expect(fields.destination).toBe("GDEST");
		expect(fields.asset).toBe("XLM");
		expect(fields.amount).toBe(50);
	});

	it("a non-co-signed DENY shows collected < required and lifecycle DENIED", () => {
		const fields = buildStellarAuditMetadata(META, {
			cosigned: false,
			denied: true,
			requiredSigners: 2,
			collectedSigners: 1,
			threshold: 2,
		});
		expect(fields.collectedSigners).toBeLessThan(fields.requiredSigners ?? 0);
		expect(fields.threshold).toBe(2);
		expect(fields.lifecycle).toBe("DENIED");
		expect(fields.txHash).toBeUndefined();
	});

	it("a co-signed, confirmed execution shows collected == required, txHash, CONFIRMED", () => {
		const fields = buildStellarAuditMetadata(META, {
			cosigned: true,
			requiredSigners: 2,
			collectedSigners: 2,
			threshold: 2,
			txHash: "tx_hash_value",
		});
		expect(fields.collectedSigners).toBe(fields.requiredSigners);
		expect(fields.txHash).toBe("tx_hash_value");
		expect(fields.lifecycle).toBe("CONFIRMED");
	});

	it("a submission failure sets networkError, no txHash, lifecycle REJECTED", () => {
		const fields = buildStellarAuditMetadata(META, {
			cosigned: true,
			requiredSigners: 2,
			collectedSigners: 2,
			threshold: 2,
			networkError: "tx_timeout",
		});
		expect(fields.networkError).toBe("tx_timeout");
		expect(fields.txHash).toBeUndefined();
		expect(fields.lifecycle).toBe("REJECTED");
	});

	it("a co-signed but not-yet-submitted action is COSIGNED_BY_COMPASS", () => {
		const fields = buildStellarAuditMetadata(META, {
			cosigned: true,
			requiredSigners: 2,
			collectedSigners: 2,
			threshold: 2,
		});
		expect(fields.lifecycle).toBe("COSIGNED_BY_COMPASS");
	});

	it("never leaks raw XDR or secret material", () => {
		const cosign: StellarCoSigningResult = {
			cosigned: true,
			requiredSigners: 2,
			collectedSigners: 2,
			threshold: 2,
			txHash: "abc",
		};
		const serialized = JSON.stringify(buildStellarAuditMetadata(META, cosign));
		expect(serialized.toLowerCase()).not.toContain("secret");
		expect(serialized).not.toContain("AAAA"); // typical XDR base64 prefix
	});

	it("does not import from legacy/", () => {
		const source = readFileSync(
			path.resolve(__dirname, "..", "stellarAuditMetadata.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/legacy\//);
	});
});
