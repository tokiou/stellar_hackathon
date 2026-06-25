import type {
	ChainAdapter,
	ChainAuditMetadata,
	SemanticFacts,
} from "@shared/chainContracts";

import { decodeStellarEnvelope } from "./transactions/stellarTransactionDecoder";
import type { StellarDecodeResult } from "./transactions/stellarTransactionContracts";

type StellarDecodeFailure = Extract<StellarDecodeResult, { ok: false }>;

const STELLAR_NETWORK = "testnet";

/**
 * Stellar sibling of `SolanaChainAdapter` (Stellar Wave 2). Wires the XDR
 * decoder into the Wave 0 `ChainAdapter` seam so the brain consumes neutral
 * `SemanticFacts` for Stellar transactions. `cosign`/`submit`/`inspectAccount`
 * are deferred to Wave 4.
 */
export class StellarChainAdapter implements ChainAdapter {
	readonly chainId = "stellar" as const;

	async decode(payload: string): Promise<SemanticFacts> {
		const result = await decodeStellarEnvelope(payload);
		if (!result.ok) {
			// strict:false disables ok:false narrowing in this repo; cast the variant.
			const failure = result as StellarDecodeFailure;
			throw new Error(
				`STELLAR_DECODE_${failure.reason}: ${failure.message}`,
			);
		}
		return result.facts;
	}

	buildAuditMetadata(
		facts: SemanticFacts,
		result?: unknown,
	): ChainAuditMetadata {
		const metadata: ChainAuditMetadata = {
			chainId: this.chainId,
			network: STELLAR_NETWORK,
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
