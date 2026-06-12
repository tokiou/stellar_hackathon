import { describe, expect, it, afterEach } from "vitest";

import {
	createPendingTransactionStore,
	type PendingTransactionEntry,
} from "../pendingTransactionStore";

const ENTRY: PendingTransactionEntry = {
	candidateId: "candidate-1",
	actionHash: "ab".repeat(32),
	unsignedVersionedTransaction: "base64encodedtx==",
	network: "devnet",
	tool: "guarded_transfer_sol",
	action: "transfer",
};

describe("PendingTransactionStore", () => {
	const store = createPendingTransactionStore();

	afterEach(() => {
		store.clear();
	});

	it("records and consumes entry by candidateId", () => {
		store.record(ENTRY);
		const consumed = store.consumeByCandidateId("candidate-1");
		expect(consumed).toEqual(ENTRY);
		// Consume is one-time: second call returns undefined
		expect(store.consumeByCandidateId("candidate-1")).toBeUndefined();
	});

	it("records and consumes entry by actionHash", () => {
		store.record(ENTRY);
		const consumed = store.consumeByActionHash("ab".repeat(32));
		expect(consumed).toEqual(ENTRY);
		// Consume is one-time: second call returns undefined
		expect(store.consumeByActionHash("ab".repeat(32))).toBeUndefined();
	});

	it("returns undefined when no entry matches candidateId", () => {
		expect(store.consumeByCandidateId("nonexistent")).toBeUndefined();
	});

	it("returns undefined when no entry matches actionHash", () => {
		expect(store.consumeByActionHash("cd".repeat(32))).toBeUndefined();
	});

	it("hasByCandidateId returns true when entry exists", () => {
		store.record(ENTRY);
		expect(store.hasByCandidateId("candidate-1")).toBe(true);
	});

	it("hasByCandidateId returns false when no entry exists", () => {
		expect(store.hasByCandidateId("nonexistent")).toBe(false);
	});

	it("clear removes all entries", () => {
		store.record(ENTRY);
		store.clear();
		expect(store.hasByCandidateId("candidate-1")).toBe(false);
		expect(store.consumeByCandidateId("candidate-1")).toBeUndefined();
	});

	it("consume by candidateId removes actionHash index", () => {
		store.record(ENTRY);
		store.consumeByCandidateId("candidate-1");
		expect(store.consumeByActionHash("ab".repeat(32))).toBeUndefined();
	});

	it("consume by actionHash removes candidateId index", () => {
		store.record(ENTRY);
		store.consumeByActionHash("ab".repeat(32));
		expect(store.consumeByCandidateId("candidate-1")).toBeUndefined();
	});

	it("overwrites entry on duplicate candidateId", () => {
		store.record(ENTRY);
		store.record({ ...ENTRY, unsignedVersionedTransaction: "updated==" });
		const consumed = store.consumeByCandidateId("candidate-1");
		expect(consumed?.unsignedVersionedTransaction).toBe("updated==");
	});
});