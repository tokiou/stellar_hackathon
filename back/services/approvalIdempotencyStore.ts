export type ConsumeResult =
	| { ok: true }
	| { ok: false; reason: "DUPLICATE_APPROVAL_EXECUTION" };

export interface ApprovalIdempotencyStore {
	consume(candidateId: string): ConsumeResult;
	has(candidateId: string): boolean;
	clear(): void; // for test teardown only
}

// Module-level singleton store
let store: Map<string, boolean>;

function initializeStore(): Map<string, boolean> {
	return new Map();
}

export function createApprovalIdempotencyStore(): ApprovalIdempotencyStore {
	if (!store) {
		store = initializeStore();
	}

	return {
		consume(candidateId: string): ConsumeResult {
			if (store.has(candidateId)) {
				return { ok: false, reason: "DUPLICATE_APPROVAL_EXECUTION" };
			}
			store.set(candidateId, true);
			return { ok: true };
		},

		has(candidateId: string): boolean {
			return store.has(candidateId);
		},

		clear(): void {
			store.clear();
		},
	};
}

// Default singleton instance
export const defaultApprovalIdempotencyStore = createApprovalIdempotencyStore();
