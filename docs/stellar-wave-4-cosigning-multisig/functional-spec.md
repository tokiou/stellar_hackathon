# Stellar Wave 4 — Co-signing and multisig functional spec

Stellar Wave 4 is the core of the Compass thesis: Compass is a **policy-gated co-signer** for Stellar agent wallets. The user signs a transaction; Compass evaluates it through the existing brain (policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS`); Compass adds its own signature **only if policy passes**. Because the Stellar account requires multiple signatures (native multisig with account-level signer weights and thresholds), a transaction that Compass refuses to sign cannot meet the threshold and is therefore not executable. The brain stays untouched; Solana keeps working unchanged in parallel.

## Business Problem

Compass's current signing model is **single-signer and Solana-typed**. `back/services/support/signer/signerAdapterContracts.ts` types `SignerAdapter` directly on Solana's `VersionedTransaction`, and `back/services/support/signer/signerAdapter.ts` does `tx.sign([this.keypair])` followed by `sendRawTransaction`. Grepping the signer code for `multisig`, `cosign`, or `threshold` returns nothing. The model assumes one key that both authorizes and submits.

The Stellar thesis is intrinsically **multi-signature**: the guarantee that policy cannot be bypassed comes from the account requiring more than one signature to reach its threshold. A single-signer adapter cannot express "Compass is one of several required signers and contributes its signature only on ALLOW." This is the central structural gap, and closing it is what makes Compass a real guardrail on Stellar rather than a suggestion.

**Why Stellar makes this elegant.** On Solana, Compass needed a custom Anchor program (`back/solana/agent-action-guard`) to *force* the policy gate on-chain. Stellar gives the same guarantee **natively**: account signers plus low/medium/high thresholds mean that if Compass's required signature is missing, the network itself rejects the transaction — no custom contract required. The policy gate is enforced by Stellar's own consensus rules. This is the "why Stellar" argument.

## Goals

- Define a multi-signer-aware co-signing contract that generalizes the single-signer `SignerAdapter` and is **not** typed on `VersionedTransaction`; it operates on a base64 `TransactionEnvelope` XDR string.
- Implement `cosign(envelopeXdr)` for Stellar (Wave 0's `ChainAdapter.cosign`): on a brain ALLOW, add **only Compass's** signature to the envelope and return the augmented XDR; never submit.
- Implement `inspectAccount(address)`: read the account's signers, weights, and low/medium/high thresholds from Horizon to verify the real multisig configuration before relying on it.
- Hold Compass's own Stellar testnet keypair behind an env flag analogous to `COMPASS_LOCAL_SIGNER_ENABLED`, testnet-only. Compass is an **additional** signer and never custodies the user's key.
- Enforce envelope-to-candidate binding so Compass cannot be tricked into signing a different transaction than the one it evaluated.
- Cover the behavior with backend tests.

## Non-Goals

- No production custody of any private key.
- No mainnet support of any kind.
- No submitting on the user's behalf by default (the user or the network submits).
- No automated keeper or background execution engine.
- No change to the brain (policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS`, MCP proxy).
- No change to any Solana provider or Solana signing behavior.
- No `legacy/` imports.

## User-Visible Scenarios

These are the two thesis-defining demo cases. The decision comes from the existing brain (fed by Waves 2-3); Wave 4 only acts on that decision.

### User signs but Compass does NOT sign (policy DENY/ESCALATE) — not executable

Given a Stellar account configured so its threshold requires both the user's signature and Compass's signature, and a transaction the user has already signed, when the brain returns `DENY` or an unresolved `REQUIRE_HUMAN_APPROVAL` (ESCALATE), then `cosign` does **not** add Compass's signature and returns a structured refusal. When the envelope is submitted, the account threshold is **not met** and the network rejects the transaction — it is not executable.

### User and Compass both sign (policy ALLOW) — executable

Given the same account and a user-signed transaction, when the brain returns `ALLOW`, then `cosign` adds **only Compass's** signature and returns the augmented XDR. The combined signature weight now meets the threshold, so the transaction is executable when submitted.

### Account multisig configuration is verified before being trusted

Given an account address, when `inspectAccount` is called, then Compass reads the real signers, weights, and low/medium/high thresholds from Horizon and exposes them, so the demo can confirm that without Compass's signature the threshold is genuinely unmet.

### Compass cannot be tricked into signing a different transaction

Given a candidate that the brain evaluated and approved, when `cosign` is asked to sign an envelope whose fingerprint does not match that candidate, then Compass refuses (structured refusal) and does not sign — Compass only ever signs the exact transaction it evaluated.

## Acceptance Criteria

- Compass adds **only its own** signature to the envelope; it never signs with or holds the user's key.
- Compass never submits the transaction unilaterally; `cosign` returns the augmented XDR and stops.
- `cosign` is gated on the brain's `ALLOW`; on `DENY` or unresolved `ESCALATE` it returns a structured refusal and adds no signature.
- `inspectAccount` reads real signers, weights, and low/medium/high thresholds from Horizon.
- Envelope-to-candidate binding is enforced: the envelope's fingerprint must match the evaluated candidate or Compass refuses to sign.
- With Compass's signature absent, the account threshold is unmet — verified against the inspected account configuration.
- The co-signing contract works on a base64 `TransactionEnvelope` XDR string and is not typed on `VersionedTransaction`.
- Compass's signer is testnet-only, behind an env flag; mainnet is refused.
- The brain is untouched and the Solana single-signer signing path stays green.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — provides the `ChainAdapter` seam with optional `cosign` and the neutral `AccountSignerState` type this wave fills in for Stellar.
- `stellar-wave-1-stellar-connectivity` — provides the testnet Horizon connectivity `inspectAccount` reads from.
- `stellar-wave-2-xdr-decoder` — decodes the base64 `TransactionEnvelope` XDR so the operations and fingerprint can be derived.
- `stellar-wave-3-operation-mapping` — feeds the brain the mapped `actionKind` / `riskClass` / context that produces the ALLOW / DENY / ESCALATE decision `cosign` gates on.

## Deferred To Later Waves

- Configuring the account's multisig for the demo (master weight + Compass key summing to threshold) — owned by Wave 6.
- Submission orchestration and execution confirmation flows beyond returning the augmented XDR.
- Production custody, mainnet support, and any non-testnet signer.
- Automated keeper / unattended co-signing.
- Soroban contract-invocation co-signing semantics.
