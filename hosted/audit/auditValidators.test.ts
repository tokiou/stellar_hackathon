import type { AuditEntry } from "@shared/evaluationContracts";
import { describe, expect, it } from "vitest";

import { createInMemoryAuditStore } from "./auditStore";
import { validateAuditWriteRequest } from "./auditValidators";

const LEGACY_ENTRY: AuditEntry = {
	correlationId: "corr-1",
	auditRef: "aud-1",
	toolName: "transfer_sol",
	decision: "allow",
	riskLevel: "low",
	reasons: ["TRANSFER_WITHIN_LIMIT_KNOWN_RECIPIENT"],
	occurredAt: "2026-06-25T00:00:00.000Z",
};

const STELLAR_ENTRY: AuditEntry = {
	...LEGACY_ENTRY,
	correlationId: "corr-2",
	chain: "stellar",
	network: "testnet",
	sourceAccount: "GSOURCE",
	destination: "GDEST",
	asset: "XLM",
	amount: 12.5,
	requiredSigners: 2,
	collectedSigners: 1,
	threshold: 2,
	networkError: undefined,
	lifecycle: "DENIED",
};

function validate(entry: unknown) {
	return validateAuditWriteRequest({ idempotencyKey: "idem-1", entry });
}

describe("validateAuditWriteRequest — backward compatibility", () => {
	it("accepts a pre-Wave-5 entry with only the original fields", () => {
		expect(validate(LEGACY_ENTRY).ok).toBe(true);
	});

	it("accepts an entry with the full set of new optional fields", () => {
		expect(validate(STELLAR_ENTRY).ok).toBe(true);
	});
});

describe("validateAuditWriteRequest — invalid present fields", () => {
	it("rejects an invalid lifecycle", () => {
		expect(validate({ ...LEGACY_ENTRY, lifecycle: "BOGUS" }).ok).toBe(false);
	});

	it("rejects a negative threshold", () => {
		expect(validate({ ...LEGACY_ENTRY, threshold: -1 }).ok).toBe(false);
	});

	it("rejects a non-ChainId chain", () => {
		expect(validate({ ...LEGACY_ENTRY, chain: "ethereum" }).ok).toBe(false);
	});

	it("rejects a non-integer collectedSigners", () => {
		expect(validate({ ...LEGACY_ENTRY, collectedSigners: 1.5 }).ok).toBe(false);
	});
});

describe("auditStore round-trip", () => {
	it("writes and lists a legacy Solana entry unchanged", async () => {
		const store = createInMemoryAuditStore();
		await store.writeAudit({
			idempotencyKey: "idem-legacy",
			entry: LEGACY_ENTRY,
			userId: "user-1",
		});
		const listed = await store.listAudits({ userId: "user-1" });
		expect(listed).toHaveLength(1);
		expect(listed[0]?.correlationId).toBe("corr-1");
		expect(listed[0]?.chain).toBeUndefined();
	});

	it("writes and lists an enriched Stellar entry with signer fields", async () => {
		const store = createInMemoryAuditStore();
		await store.writeAudit({
			idempotencyKey: "idem-stellar",
			entry: STELLAR_ENTRY,
			userId: "user-2",
		});
		const listed = await store.listAudits({ userId: "user-2" });
		expect(listed[0]?.chain).toBe("stellar");
		expect(listed[0]?.collectedSigners).toBe(1);
		expect(listed[0]?.requiredSigners).toBe(2);
		expect(listed[0]?.lifecycle).toBe("DENIED");
	});
});
