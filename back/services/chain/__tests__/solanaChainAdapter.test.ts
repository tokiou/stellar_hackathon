import {
	Keypair,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { SolanaChainAdapter } from "../solana/solanaChainAdapter";

/**
 * Builds a serialized unsigned VersionedTransaction the SAME way the production
 * builder does (SystemProgram.transfer -> compileToV0Message ->
 * VersionedTransaction -> base64). This is the parity anchor: decode must read
 * back exactly what the Solana transfer path produces. No network needed — a
 * generated pubkey is a valid 32-byte recentBlockhash string.
 */
function buildTransferPayload(input: {
	from: Keypair;
	to: Keypair;
	lamports: number;
}): string {
	const message = new TransactionMessage({
		payerKey: input.from.publicKey,
		recentBlockhash: Keypair.generate().publicKey.toBase58(),
		instructions: [
			SystemProgram.transfer({
				fromPubkey: input.from.publicKey,
				toPubkey: input.to.publicKey,
				lamports: input.lamports,
			}),
		],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);
	return Buffer.from(tx.serialize()).toString("base64");
}

describe("SolanaChainAdapter", () => {
	const adapter = new SolanaChainAdapter();

	it("has chainId 'solana'", () => {
		expect(adapter.chainId).toBe("solana");
	});

	it("decode() yields SemanticFacts matching the Solana transfer payload", async () => {
		const from = Keypair.generate();
		const to = Keypair.generate();
		const payload = buildTransferPayload({
			from,
			to,
			lamports: 1_500_000_000,
		});

		const facts = await adapter.decode(payload);

		expect(facts.actionKind).toBe("transfer");
		expect(facts.sourceAddress).toBe(from.publicKey.toBase58());
		expect(facts.recipientAddress).toBe(to.publicKey.toBase58());
		expect(facts.asset).toBe("SOL");
		expect(facts.amount).toBeCloseTo(1.5, 9);
	});

	it("decode() rejects an unsupported payload", async () => {
		await expect(adapter.decode("not-a-real-tx")).rejects.toThrow();
	});

	it("buildAuditMetadata() leaks no raw tx bytes or secret material", async () => {
		const from = Keypair.generate();
		const to = Keypair.generate();
		const payload = buildTransferPayload({ from, to, lamports: 2_000_000_000 });
		const facts = await adapter.decode(payload);

		const metadata = adapter.buildAuditMetadata(facts, {
			txHash: "abc123",
		});
		const serialized = JSON.stringify(metadata);

		expect(metadata.chainId).toBe("solana");
		expect(metadata.network).toBe("solana");
		expect(metadata.actionKind).toBe("transfer");
		expect(metadata.txHash).toBe("abc123");
		// No raw payload, no private keys.
		expect(serialized).not.toContain(payload);
		expect(serialized.toLowerCase()).not.toContain("secret");
		expect(serialized).not.toContain(from.secretKey.toString());
	});
});
