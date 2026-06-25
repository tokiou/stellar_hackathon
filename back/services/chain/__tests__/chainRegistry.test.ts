import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
	AccountSignerState,
	ChainAdapter,
	ChainAuditMetadata,
	ChainId,
	SemanticFacts,
} from "@shared/chainContracts";

import { resolveChainAdapter } from "../chainRegistry";

describe("chainContracts seam", () => {
	it("a class implementing only the required members satisfies ChainAdapter", () => {
		// If optional methods were required, this would not compile.
		class MinimalAdapter implements ChainAdapter {
			readonly chainId: ChainId = "solana";
			async decode(): Promise<SemanticFacts> {
				return {
					actionKind: "transfer",
					sourceAddress: "S",
					recipientAddress: "R",
					asset: "X",
					amount: 0,
					amountUsd: 0,
				};
			}
			buildAuditMetadata(facts: SemanticFacts): ChainAuditMetadata {
				return {
					chainId: this.chainId,
					network: "n",
					actionKind: facts.actionKind,
				};
			}
		}

		const adapter: ChainAdapter = new MinimalAdapter();
		expect(adapter.chainId).toBe("solana");
		expect(adapter.cosign).toBeUndefined();
		expect(adapter.submit).toBeUndefined();
		expect(adapter.inspectAccount).toBeUndefined();

		// Exercise the neutral types so they are referenced (compile-shape guard).
		const account: AccountSignerState = { address: "S", exists: false };
		expect(account.exists).toBe(false);
	});
});

describe("resolveChainAdapter", () => {
	it("resolves Solana to an adapter with chainId 'solana'", () => {
		const result = resolveChainAdapter("solana");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.adapter.chainId).toBe("solana");
		}
	});

	it("resolves Stellar to an adapter with chainId 'stellar' (registered in Wave 2)", () => {
		const result = resolveChainAdapter("stellar");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.adapter.chainId).toBe("stellar");
		}
	});

	it("fails explicitly for an unregistered chain (no silent fallback)", () => {
		const result = resolveChainAdapter("aptos" as unknown as ChainId);
		expect(result).toEqual({
			ok: false,
			reason: "CHAIN_ADAPTER_NOT_REGISTERED",
		});
	});
});

describe("no legacy imports in chain files", () => {
	it("new chain files do not import from legacy/", () => {
		const files = [
			"chainRegistry.ts",
			"chainConfig.ts",
			"solana/solanaChainAdapter.ts",
		];
		for (const rel of files) {
			const source = readFileSync(
				path.resolve(__dirname, "..", rel),
				"utf8",
			);
			expect(source).not.toMatch(/legacy\//);
		}
	});
});
