import { afterEach, describe, expect, it } from "vitest";

import {
	createApprovalIdempotencyStore,
	defaultApprovalIdempotencyStore,
} from "../approvalIdempotencyStore";

afterEach(() => {
	defaultApprovalIdempotencyStore.clear();
});

describe("createApprovalIdempotencyStore", () => {
	it("store is created", () => {
		const store = createApprovalIdempotencyStore();

		expect(store).toBeDefined();
		expect(typeof store.consume).toBe("function");
		expect(typeof store.has).toBe("function");
		expect(typeof store.clear).toBe("function");
	});

	it("consume returns ok true first call", () => {
		const store = createApprovalIdempotencyStore();

		expect(store.consume("candidate-1")).toEqual({ ok: true });
	});

	it("consume returns DUPLICATE_APPROVAL_EXECUTION on repeat", () => {
		const store = createApprovalIdempotencyStore();

		expect(store.consume("candidate-1")).toEqual({ ok: true });
		expect(store.consume("candidate-1")).toEqual({
			ok: false,
			reason: "DUPLICATE_APPROVAL_EXECUTION",
		});
	});

	it("consume returns ok true for different id", () => {
		const store = createApprovalIdempotencyStore();

		expect(store.consume("candidate-1")).toEqual({ ok: true });
		expect(store.consume("candidate-2")).toEqual({ ok: true });
	});

	it("has returns false then true after consume", () => {
		const store = createApprovalIdempotencyStore();

		expect(store.has("candidate-1")).toBe(false);
		store.consume("candidate-1");
		expect(store.has("candidate-1")).toBe(true);
	});

	it("clear resets state", () => {
		const store = createApprovalIdempotencyStore();

		expect(store.consume("candidate-1")).toEqual({ ok: true });
		expect(store.has("candidate-1")).toBe(true);

		store.clear();

		expect(store.has("candidate-1")).toBe(false);
		expect(store.consume("candidate-1")).toEqual({ ok: true });
	});
});

describe("defaultApprovalIdempotencyStore", () => {
	it("singleton is exported", () => {
		expect(defaultApprovalIdempotencyStore).toBeDefined();
		expect(typeof defaultApprovalIdempotencyStore.consume).toBe("function");
	});
});
