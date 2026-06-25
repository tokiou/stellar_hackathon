# Stellar Wave 2 — XDR decoder to semantic facts technical spec

Stellar Wave 2 implements decode for the `StellarChainAdapter`. It parses a base64 `TransactionEnvelope` XDR with `@stellar/stellar-sdk` and produces the chain-neutral `SemanticFacts` from Wave 0, so the brain never touches XDR. The implementation mirrors the Solana transaction-decoding modules under `back/services/solana/transactions/` and slots into the same `ChainAdapter` seam.

## Architecture

```txt
StellarChainAdapter.decode(base64Xdr)
  -> stellarTransactionDecoder.decode(base64Xdr)
    -> @stellar/stellar-sdk: TransactionEnvelope.fromXDR(base64, "base64")
      -> read source account
      -> read memo
      -> for each operation (ordered, ALL of them):
           classify operation kind
           payment / path payment:
             -> resolve asset: native XLM marker | { code, issuer }
             -> stellarAmount.stroopsToDisplay(amountStroops)  // 7 decimals
             -> read destination -> recipientAddress
      -> stellarPriceProvider.amountToUsd(asset, amount) -> amountUsd
      -> assemble per-envelope SemanticFacts (worst-case risk if any op critical)
  -> malformed input -> StellarDecodeError (no partial fact)
```

Solana keeps working unchanged through `SolanaChainAdapter`; this wave only adds the Stellar sibling's decode path.

## Files

| File | Role |
| --- | --- |
| `back/services/stellar/transactions/stellarTransactionDecoder.ts` | Parse base64 `TransactionEnvelope` XDR into `SemanticFacts`; decode all operations; fail safe on malformed input. |
| `back/services/stellar/transactions/stellarAmount.ts` | Convert stroops <-> display units at 7 decimals (10^7 stroops = 1 XLM). |
| `back/services/stellar/providers/stellarPriceProvider.ts` | Map `amount` -> `amountUsd` behind a configurable provider; stub fallback. |
| `back/services/stellar/stellarChainAdapter.ts` | `StellarChainAdapter.decode` wiring the decoder into the Wave 0 `ChainAdapter` seam. |
| `back/services/stellar/__tests__/stellarTransactionDecoder.test.ts` | Decoder behavior across native, issued, multi-op, and malformed inputs. |
| `back/services/stellar/__tests__/stellarAmount.test.ts` | Stroop/decimal conversion correctness and round-trip. |
| `back/services/stellar/__tests__/stellarPriceProvider.test.ts` | Price mapping and stub fallback. |
| `.env.example` | Add `FALLBACK_XLM_USD_PRICE` analogous to `FALLBACK_SOL_USD_PRICE`. |

## Contracts

The decoder returns the Wave 0 `SemanticFacts` type — it does not define a new brain contract. Internal shapes:

```ts
// Neutral asset representation populated by the decoder.
export type StellarAssetFact =
  | { kind: "native"; symbol: "XLM" }
  | { kind: "issued"; code: string; issuer: string };

// One decoded operation, ordered as in the envelope.
export interface StellarDecodedOperation {
  index: number;
  operationKind: "payment" | "path_payment" | "other";
  recipientAddress?: string;
  asset?: StellarAssetFact;
  amount?: string; // display units, 7 decimals, decimal string (no float)
}

// Discriminated decode result — never a partial SemanticFacts.
export type StellarDecodeResult =
  | { ok: true; facts: SemanticFacts; operations: StellarDecodedOperation[] }
  | { ok: false; reason: "MALFORMED_XDR" | "UNSUPPORTED_ENVELOPE"; message: string };

export interface StellarPriceProvider {
  amountToUsd(asset: StellarAssetFact, amount: string): Promise<number | null>;
}
```

`SemanticFacts.asset` carries `"XLM"` for native and a code+issuer encoding for issued assets, so the policy engine reads one neutral field regardless of chain.

## Behavior

- Parse with `TransactionEnvelope.fromXDR(base64, "base64")`. Any throw or non-envelope input becomes `{ ok: false, reason: "MALFORMED_XDR" }` — never a defaulted fact.
- Read `sourceAccount` -> `SemanticFacts.sourceAddress`; read `memo` and carry it through.
- Iterate `operations` in order and decode every one. A payment or path payment yields `recipientAddress`, `asset`, and `amount`; other operation kinds are surfaced as `operationKind: "other"` without inventing payment fields.
- Asset resolution: native -> `{ kind: "native", symbol: "XLM" }`; issued -> `{ kind: "issued", code, issuer }`. Both map to `SemanticFacts.asset`.
- Amount: convert integer stroops to a 7-decimal display string via `stellarAmount`. Never use floating-point math for money; use string/bigint conversion. Stellar stroops (7 decimals) are distinct from Solana lamports (9 decimals); the decoder must not share the Solana divisor.
- `amountUsd`: call `stellarPriceProvider.amountToUsd`. When live pricing is unavailable, fall back to `FALLBACK_XLM_USD_PRICE` for native XLM; issued assets without a known price use the stub/allowlist (Q1).
- Multi-operation envelope: produce one per-envelope `SemanticFacts` candidate (Q2) whose `actionKind` is `"transfer"` when a payment is present and whose risk escalates to the worst case if any operation is critical; `operations[]` is returned alongside for Wave 3.
- The decoder is pure with respect to the brain: it never calls the policy engine, judge, sanitizer, or MCP proxy.

## Tests

- Native XLM payment XDR -> `SemanticFacts` with `actionKind: "transfer"`, `asset: "XLM"`, correct `amount`, `amountUsd`.
- Issued-asset payment XDR -> `asset` carries code + issuer.
- Multi-operation / path-payment envelope -> all operations surfaced in order; one per-envelope candidate.
- Malformed / non-base64 / non-envelope input -> `{ ok: false, reason: "MALFORMED_XDR" }`, no partial fact.
- `stellarAmount`: 1 XLM = 10,000,000 stroops; sub-unit stroops; round-trip stroops <-> display; no float drift.
- Assert the divisor is 10^7 and differs from the Solana lamport divisor (regression against decimal confusion).
- `stellarPriceProvider`: returns configured price; falls back to `FALLBACK_XLM_USD_PRICE`; returns `null`/stub for unknown issued assets.
- `StellarChainAdapter.decode` returns the Wave 0 `SemanticFacts` type and is resolvable through the `chainRegistry` for `ChainId` `"stellar"`.
- Solana decoding regression: existing Solana tests stay green.
- No `legacy/` import in any new Stellar file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: full backend suite passes including pre-existing Solana tests; lint clean aside from pre-existing warnings; typecheck exits zero with `decode` returning the Wave 0 `SemanticFacts`. No test results are asserted in this planning spec.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — `ChainAdapter`, `ChainId`, `SemanticFacts` in `shared/types/chainContracts.ts`; `chainRegistry`.
- `stellar-wave-1-stellar-connectivity` — `@stellar/stellar-sdk` wiring, Stellar network config, connectivity.

## Deferred

- `StellarChainAdapter.cosign`, `submit`, and `inspectAccount` — later Stellar wave.
- Production USD valuation for issued assets beyond the testnet stub/allowlist.
- Soroban contract-invocation decoding and richer non-payment operation semantics.
- Policy-engine consumption of the multi-operation per-envelope candidate and worst-case escalation — Wave 3.
- Stellar-specific policy thresholds and audit fields.
