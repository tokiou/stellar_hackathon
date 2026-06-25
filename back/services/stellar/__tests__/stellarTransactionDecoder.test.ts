import { readFileSync } from "node:fs";
import path from "node:path";

import {
	Account,
	Asset,
	Keypair,
	Memo,
	Networks,
	Operation,
	TransactionBuilder,
	xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { resolveChainAdapter } from "../../chain/chainRegistry";
import { decodeStellarEnvelope } from "../transactions/stellarTransactionDecoder";

const SOURCE = Keypair.random();
const DEST = Keypair.random();
const USDC = new Asset(
	"USDC",
	"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);

function buildXdr(operations: xdr.Operation[], memo?: Memo): string {
	const account = new Account(SOURCE.publicKey(), "123456789");
	let builder = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: Networks.TESTNET,
	});
	for (const op of operations) {
		builder = builder.addOperation(op);
	}
	if (memo) {
		builder = builder.addMemo(memo);
	}
	return builder.setTimeout(60).build().toXDR();
}

describe("decodeStellarEnvelope", () => {
	it("decodes a native XLM payment into transfer SemanticFacts", async () => {
		const xdr = buildXdr([
			Operation.payment({
				destination: DEST.publicKey(),
				asset: Asset.native(),
				amount: "1.5000000",
			}),
		]);

		const result = await decodeStellarEnvelope(xdr, {
			networkPassphrase: Networks.TESTNET,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.facts.actionKind).toBe("transfer");
		expect(result.facts.sourceAddress).toBe(SOURCE.publicKey());
		expect(result.facts.recipientAddress).toBe(DEST.publicKey());
		expect(result.facts.asset).toBe("XLM");
		expect(result.facts.amount).toBeCloseTo(1.5, 7);
		expect(result.facts.amountUsd).toBeGreaterThan(0);
		expect(result.operations).toHaveLength(1);
	});

	it("carries code+issuer for an issued-asset payment", async () => {
		const xdr = buildXdr([
			Operation.payment({
				destination: DEST.publicKey(),
				asset: USDC,
				amount: "42.0000000",
			}),
		]);

		const result = await decodeStellarEnvelope(xdr, {
			networkPassphrase: Networks.TESTNET,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.facts.asset).toBe(
			"USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
		);
		// Issued asset has no testnet price -> usd unknown, flagged not silent.
		expect(result.facts.amountUsd).toBe(0);
		expect(result.facts.riskFlags).toContain("amount_usd_unknown");
	});

	it("surfaces ALL operations in order for a multi-operation envelope", async () => {
		const xdr = buildXdr([
			Operation.payment({
				destination: DEST.publicKey(),
				asset: Asset.native(),
				amount: "2.0000000",
			}),
			Operation.changeTrust({ asset: USDC }),
		]);

		const result = await decodeStellarEnvelope(xdr, {
			networkPassphrase: Networks.TESTNET,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.operations).toHaveLength(2);
		expect(result.operations[0]?.operationKind).toBe("payment");
		expect(result.operations[1]?.rawType).toBe("changeTrust");
		expect(result.operations[1]?.operationKind).toBe("other");
		// One per-envelope candidate; primary payment drives the facts.
		expect(result.facts.actionKind).toBe("transfer");
		expect(result.facts.riskFlags).toContain("multi_operation");
		expect(result.facts.riskFlags).toContain("op:changeTrust");
	});

	it("rejects malformed XDR with a clear error and no partial facts", async () => {
		const result = await decodeStellarEnvelope("not-valid-xdr", {
			networkPassphrase: Networks.TESTNET,
		});
		// strict:false disables ok:false narrowing; assert on the shape directly.
		expect(result.ok).toBe(false);
		expect(result).toMatchObject({ reason: "MALFORMED_XDR" });
		expect(result).not.toHaveProperty("facts");
	});

	it("does not import from legacy/", () => {
		const files = [
			"transactions/stellarTransactionDecoder.ts",
			"transactions/stellarAmount.ts",
			"transactions/stellarTransactionContracts.ts",
			"providers/stellarPriceProvider.ts",
			"stellarChainAdapter.ts",
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

describe("StellarChainAdapter via chainRegistry", () => {
	it("is resolvable for ChainId 'stellar' and decodes through the adapter", async () => {
		const resolved = resolveChainAdapter("stellar");
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.adapter.chainId).toBe("stellar");

		const xdr = buildXdr([
			Operation.payment({
				destination: DEST.publicKey(),
				asset: Asset.native(),
				amount: "3.0000000",
			}),
		]);
		const facts = await resolved.adapter.decode(xdr);
		expect(facts.actionKind).toBe("transfer");
		expect(facts.recipientAddress).toBe(DEST.publicKey());

		const metadata = resolved.adapter.buildAuditMetadata(facts);
		expect(metadata.chainId).toBe("stellar");
		expect(metadata.network).toBe("testnet");
	});
});
