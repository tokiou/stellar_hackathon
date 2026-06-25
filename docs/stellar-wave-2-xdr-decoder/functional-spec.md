# Stellar Wave 2 — XDR decoder to semantic facts functional spec

Stellar Wave 2 implements `ChainAdapter.decode` for Stellar. Stellar represents a transaction as XDR — a `TransactionEnvelope` transported as base64 — which the Compass brain must never parse. This wave parses that envelope into the chain-neutral `SemanticFacts` defined in Wave 0 (`shared/types/chainContracts.ts`), so the unchanged policy engine, judge, and sanitizer can evaluate a Stellar action exactly as they evaluate a Solana one. The decoder's whole job is to make the brain able to consume Stellar transactions without the brain knowing anything about XDR, stroops, or assets.

## Business Problem

Wave 0 created the neutral `ChainAdapter` seam and Wave 1 established Stellar connectivity, but the brain still has no way to understand a Stellar transaction. A Stellar transaction arrives as an opaque base64 XDR `TransactionEnvelope`; the policy engine consumes `SemanticFacts` (`actionKind`, `sourceAddress`, `recipientAddress`, `asset`, `amount`, `amountUsd`). Without a decoder, either the brain would have to learn XDR — re-leaking chain coupling that Wave 0 removed — or Stellar actions could never be evaluated. Stellar also differs from Solana in two ways the decoder must absorb: amounts are integer stroops with seven decimals (1 XLM = 10,000,000 stroops), not nine-decimal lamports; and an asset can be native XLM or an issued asset (code + issuer). Wave 2 closes this gap by translating XDR into neutral facts at the chain boundary, leaving the brain untouched.

## Goals

- Implement a `stellarTransactionDecoder` that parses a base64 `TransactionEnvelope` XDR via `@stellar/stellar-sdk` into `SemanticFacts`.
- Surface the source account, an ordered list of all operations, and per-payment destination, asset, and amount.
- Add a `stellarAmount` module that converts stroops to and from display units at seven decimals (10^7 stroops per XLM).
- Map the neutral `asset` field cleanly for both native XLM and issued assets (code + issuer).
- Add a `stellarPriceProvider` that maps amount to `amountUsd` behind a configurable provider, starting with a simple stub fallback analogous to Solana's `FALLBACK_SOL_USD_PRICE`.
- Handle path payments and multi-operation envelopes by decoding every operation, not just the first.
- Fail safe on malformed XDR with a clear decode error and never emit a partial or ambiguous fact.
- Wire `stellarTransactionDecoder` into a `StellarChainAdapter.decode`, sibling to `SolanaChainAdapter`.

## Non-Goals

- No change to Solana — Solana decoding and all Solana tests keep working unchanged.
- No change to the brain: policy engine, LLM judge, decision sanitizer, `COMPASS_DECISIONS` semantics, and the MCP proxy stay untouched.
- No `ChainAdapter.cosign`, `submit`, or `inspectAccount` implementation — Wave 2 is decode only.
- No production-grade USD pricing for issued assets — testnet stub/allowlist only.
- No new MCP tools and no signer behavior change.
- No mainnet readiness.
- No `legacy/` imports.

## User-Visible Scenarios

These are developer- and system-visible outcomes; there is no new end-user UI in this wave.

### A native-XLM payment decodes to neutral facts

Given a base64 XDR `TransactionEnvelope` of a testnet native-XLM payment, when `StellarChainAdapter.decode` is called, then it returns `SemanticFacts` with `actionKind: "transfer"`, the payment `recipientAddress`, `asset: "XLM"`, the `amount` converted from stroops at seven decimals, and an `amountUsd` from the configured price provider.

### An issued-asset payment carries code and issuer

Given a base64 XDR of a payment in an issued asset, when the envelope is decoded, then the neutral `asset` field carries the asset code and issuer (not the native `"XLM"` marker), and the `amount` is still converted at seven decimals.

### A multi-operation envelope surfaces every operation

Given a `TransactionEnvelope` with several operations (for example a path payment plus a payment), when it is decoded, then all operations are surfaced in order, and the envelope is represented to the policy engine as one candidate whose risk escalates if any single operation is critical.

### Malformed XDR fails safe

Given a string that is not a valid base64 `TransactionEnvelope`, when decode is called, then it returns a clear decode error and never a partial, defaulted, or ambiguous `SemanticFacts`.

## Acceptance Criteria

- `stellarTransactionDecoder` parses a base64 `TransactionEnvelope` into `SemanticFacts` consumable by the unchanged policy engine.
- Stroop conversion is correct at seven decimals (10^7 stroops = 1 XLM), distinct from Solana's nine-decimal lamports.
- Native XLM maps to the neutral `asset` marker; issued assets map to code + issuer; both populate `asset` cleanly.
- Multi-operation and path-payment envelopes are decoded in full — every operation is surfaced, not just the first.
- Malformed or non-parseable XDR is rejected with a clear decode error and produces no partial fact.
- A multi-operation envelope is represented as one per-envelope candidate that escalates to the worst-case risk if any operation is critical (documented for Wave 3).
- `stellarPriceProvider` maps `amount` to `amountUsd` behind config, with a stub fallback when no live price is available.
- The brain is untouched and all existing Solana tests stay green.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: the full backend suite passes, including all pre-existing Solana tests; lint is clean aside from pre-existing warnings; the typecheck exits zero with the decoder returning the Wave 0 `SemanticFacts` type. Test results are not asserted in this planning spec — they are produced at implementation time.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — provides `ChainAdapter`, `ChainId`, and `SemanticFacts` in `shared/types/chainContracts.ts`.
- `stellar-wave-1-stellar-connectivity` — provides the Stellar SDK wiring, network config, and connectivity the decoder relies on.

## Deferred To Later Waves

- `StellarChainAdapter.cosign`, `submit`, and `inspectAccount` — a later Stellar wave.
- Production-grade USD valuation of issued assets beyond the testnet stub/allowlist.
- Soroban contract-invocation decoding and non-payment operation semantics beyond surfacing them as operations.
- The policy-engine consumption of the per-envelope multi-operation candidate and worst-case escalation — Wave 3.
- Stellar-specific policy thresholds and audit fields.
