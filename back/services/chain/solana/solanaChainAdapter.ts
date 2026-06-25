import {
	LAMPORTS_PER_SOL,
	SystemProgram,
	VersionedTransaction,
} from "@solana/web3.js";

import type {
	ChainAdapter,
	ChainAuditMetadata,
	SemanticFacts,
} from "@shared/chainContracts";

const SOL_ASSET = "SOL";
const SOLANA_NETWORK = "solana";
/** SystemProgram instruction discriminator for `Transfer` (u32 LE = 2). */
const SYSTEM_TRANSFER_INSTRUCTION_INDEX = 2;

/**
 * Wraps the existing Solana transaction modules behind the neutral
 * `ChainAdapter` seam. It does NOT re-implement or alter Solana signing/build
 * logic; it only adapts the opaque payload (a serialized `VersionedTransaction`,
 * exactly what `buildSolTransferTransactionPayload` produces) into the neutral
 * `SemanticFacts` the brain consumes.
 *
 * USD valuation is intentionally NOT computed here: structural decode is
 * offline and deterministic, while pricing requires a network oracle and is
 * layered on by the gateway/price provider. `amountUsd` is therefore 0 at
 * decode time.
 */
export class SolanaChainAdapter implements ChainAdapter {
	readonly chainId = "solana" as const;

	async decode(payload: string): Promise<SemanticFacts> {
		const tx = VersionedTransaction.deserialize(
			new Uint8Array(Buffer.from(payload, "base64")),
		);
		const message = tx.message;
		const keys = message.staticAccountKeys;

		for (const ix of message.compiledInstructions) {
			const programId = keys[ix.programIdIndex];
			if (!programId || !programId.equals(SystemProgram.programId)) {
				continue;
			}

			const data = ix.data;
			if (data.length < 12) {
				continue;
			}
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			if (view.getUint32(0, true) !== SYSTEM_TRANSFER_INSTRUCTION_INDEX) {
				continue;
			}

			const lamports = Number(view.getBigUint64(4, true));
			const from = keys[ix.accountKeyIndexes[0]];
			const to = keys[ix.accountKeyIndexes[1]];
			if (!from || !to) {
				continue;
			}

			return {
				actionKind: "transfer",
				sourceAddress: from.toBase58(),
				recipientAddress: to.toBase58(),
				asset: SOL_ASSET,
				amount: lamports / LAMPORTS_PER_SOL,
				amountUsd: 0,
			};
		}

		throw new Error("SOLANA_DECODE_UNSUPPORTED_PAYLOAD");
	}

	buildAuditMetadata(
		facts: SemanticFacts,
		result?: unknown,
	): ChainAuditMetadata {
		const metadata: ChainAuditMetadata = {
			chainId: this.chainId,
			network: SOLANA_NETWORK,
			actionKind: facts.actionKind,
			sourceAddress: facts.sourceAddress,
			recipientAddress: facts.recipientAddress,
			asset: facts.asset,
			amount: facts.amount,
		};

		if (
			result &&
			typeof result === "object" &&
			"txHash" in (result as Record<string, unknown>)
		) {
			metadata.txHash = (result as Record<string, unknown>).txHash;
		}

		return metadata;
	}
}
