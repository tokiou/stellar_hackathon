import {
	Asset,
	FeeBumpTransaction,
	Networks,
	TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { SemanticFacts } from "@shared/chainContracts";

import { createStellarPriceProvider } from "../providers/stellarPriceProvider";
import { canonicalizeAmount, displayToNumber } from "./stellarAmount";
import {
	assetFactToString,
	type StellarAssetFact,
	type StellarDecodedOperation,
	type StellarDecodeResult,
	type StellarPriceProvider,
} from "./stellarTransactionContracts";

function assetToFact(asset: Asset): StellarAssetFact {
	if (asset.isNative()) {
		return { kind: "native", symbol: "XLM" };
	}
	return { kind: "issued", code: asset.getCode(), issuer: asset.getIssuer() };
}

type DecodeOptions = {
	priceProvider?: StellarPriceProvider;
	networkPassphrase?: string;
};

/**
 * Parses a base64 `TransactionEnvelope` XDR into the Wave 0 `SemanticFacts`,
 * surfacing EVERY operation in order. Fee-bump envelopes are unwrapped to their
 * inner transaction. Malformed input yields a discriminated failure — never a
 * partial or defaulted fact.
 */
export async function decodeStellarEnvelope(
	base64Xdr: string,
	options: DecodeOptions = {},
): Promise<StellarDecodeResult> {
	const priceProvider = options.priceProvider ?? createStellarPriceProvider();
	const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

	let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
	try {
		parsed = TransactionBuilder.fromXDR(base64Xdr, networkPassphrase);
	} catch (error) {
		return {
			ok: false,
			reason: "MALFORMED_XDR",
			message: (error as Error).message,
		};
	}

	const tx =
		parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;

	const operations: StellarDecodedOperation[] = tx.operations.map(
		(op, index) => {
			if (op.type === "payment") {
				return {
					index,
					operationKind: "payment",
					rawType: op.type,
					recipientAddress: op.destination,
					asset: assetToFact(op.asset),
					amount: canonicalizeAmount(op.amount),
				};
			}
			if (op.type === "pathPaymentStrictReceive") {
				return {
					index,
					operationKind: "path_payment",
					rawType: op.type,
					recipientAddress: op.destination,
					asset: assetToFact(op.destAsset),
					amount: canonicalizeAmount(op.destAmount),
				};
			}
			if (op.type === "pathPaymentStrictSend") {
				return {
					index,
					operationKind: "path_payment",
					rawType: op.type,
					recipientAddress: op.destination,
					asset: assetToFact(op.destAsset),
					amount: canonicalizeAmount(op.destMin),
				};
			}
			return { index, operationKind: "other", rawType: op.type };
		},
	);

	const riskFlags: string[] = [];
	if (operations.length > 1) {
		riskFlags.push("multi_operation");
	}
	for (const op of operations) {
		if (op.operationKind === "other") {
			riskFlags.push(`op:${op.rawType}`);
		}
	}

	const primary = operations.find(
		(op) => op.operationKind === "payment" || op.operationKind === "path_payment",
	);

	let facts: SemanticFacts;
	if (primary?.asset && primary.amount && primary.recipientAddress) {
		const usd = await priceProvider.amountToUsd(primary.asset, primary.amount);
		if (usd === null) {
			riskFlags.push("amount_usd_unknown");
		}
		facts = {
			actionKind: "transfer",
			sourceAddress: tx.source,
			recipientAddress: primary.recipientAddress,
			asset: assetFactToString(primary.asset),
			amount: displayToNumber(primary.amount),
			amountUsd: usd ?? 0,
			riskFlags,
		};
	} else {
		facts = {
			actionKind: "other",
			sourceAddress: tx.source,
			recipientAddress: "",
			asset: "",
			amount: 0,
			amountUsd: 0,
			riskFlags,
		};
	}

	return { ok: true, facts, operations };
}
