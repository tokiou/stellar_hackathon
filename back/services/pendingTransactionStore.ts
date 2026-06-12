/**
 * In-memory pending transaction payload store for devnet approval bypass guard.
 *
 * When Compass builds a transactionPayload via guarded_transfer_sol (ALLOW or
 * REQUIRE_HUMAN_APPROVAL), it records the payload here. When execute_approved_action
 * receives a devnet request without approvalProof, it must find a matching stored
 * entry before signing — otherwise an attacker could supply arbitrary payloads.
 *
 * Entries are consumed on match (one-time use) to prevent replay.
 */
export type PendingTransactionEntry = {
	candidateId: string;
	actionHash: string;
	unsignedVersionedTransaction: string;
	network: string;
	tool: string;
	action: string;
};

export interface PendingTransactionStore {
	record(entry: PendingTransactionEntry): void;
	/**
	 * Look up and consume a pending entry by candidateId.
	 * Returns the entry if found, then removes it from the store.
	 * Returns undefined if no matching entry exists.
	 */
	consumeByCandidateId(candidateId: string): PendingTransactionEntry | undefined;
	/**
	 * Look up and consume a pending entry by actionHash.
	 * Returns the entry if found, then removes it from the store.
	 * Returns undefined if no matching entry exists.
	 */
	consumeByActionHash(actionHash: string): PendingTransactionEntry | undefined;
	/** Check whether a candidateId has a stored entry without consuming it. */
	hasByCandidateId(candidateId: string): boolean;
	/** Remove all entries. For test teardown only. */
	clear(): void;
}

// Internal map keyed by candidateId for O(1) lookup
let candidateMap: Map<string, PendingTransactionEntry> | undefined;
// Secondary map keyed by actionHash for O(1) lookup
let actionHashMap: Map<string, string> | undefined; // actionHash -> candidateId

function ensureStore(): {
	candidate: Map<string, PendingTransactionEntry>;
	actionHash: Map<string, string>;
} {
	if (!candidateMap) {
		candidateMap = new Map();
		actionHashMap = new Map();
	}
	return { candidate: candidateMap, actionHash: actionHashMap };
}

export function createPendingTransactionStore(): PendingTransactionStore {
	return {
		record(entry: PendingTransactionEntry): void {
			const store = ensureStore();
			store.candidate.set(entry.candidateId, entry);
			store.actionHash.set(entry.actionHash, entry.candidateId);
		},

		consumeByCandidateId(
			candidateId: string,
		): PendingTransactionEntry | undefined {
			const store = ensureStore();
			const entry = store.candidate.get(candidateId);
			if (entry) {
				store.candidate.delete(candidateId);
				store.actionHash.delete(entry.actionHash);
			}
			return entry;
		},

		consumeByActionHash(
			actionHash: string,
		): PendingTransactionEntry | undefined {
			const store = ensureStore();
			const candidateId = store.actionHash.get(actionHash);
			if (!candidateId) return undefined;
			return this.consumeByCandidateId(candidateId);
		},

		hasByCandidateId(candidateId: string): boolean {
			const store = ensureStore();
			return store.candidate.has(candidateId);
		},

		clear(): void {
			const store = ensureStore();
			store.candidate.clear();
			store.actionHash.clear();
		},
	};
}

/** Default singleton instance used by production code. */
export const defaultPendingTransactionStore = createPendingTransactionStore();