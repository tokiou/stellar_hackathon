# Stellar Wave 4 — Co-signing and multisig technical spec

Stellar Wave 4 implements the policy-gated co-signer for Stellar. It adds a multi-signer-aware co-signing contract that generalizes the single-signer `SignerAdapter` without typing on `VersionedTransaction`, and a Stellar co-signer that fills in Wave 0's optional `ChainAdapter.cosign` plus an `inspectAccount` reader for Horizon multisig state. Compass holds its own testnet keypair as an **additional** signer, signs only on the brain's `ALLOW`, binds the envelope to the evaluated candidate, and never submits. The brain is untouched; Solana's existing single-signer path is unchanged.

## Architecture

```txt
brain (Waves 2-3 feed it; UNCHANGED)
  evaluateAction(...) -> COMPASS_DECISIONS { ALLOW | DENY | REQUIRE_HUMAN_APPROVAL }
    |
    v
StellarChainAdapter.cosign(envelopeXdr, candidate, decision)   <- Wave 0 optional method
  stellarCosignerContracts.ts
    CosignAdapter (NOT typed on VersionedTransaction; base64 XDR string in/out)
  stellarCosigner.ts
    1. decode envelope (Wave 2) -> operations
    2. binding: fingerprint(envelope) === candidate.fingerprint ? else REFUSE
    3. gate: decision === ALLOW ? else REFUSE (DENY / ESCALATE)
    4. add ONLY Compass's testnet signature to the envelope
    5. return augmented base64 XDR  (does NOT submit)

StellarChainAdapter.inspectAccount(address)
  -> Horizon (Wave 1) -> AccountSignerState { signers[], weights, thresholds{low,med,high} }

Solana single-signer SignerAdapter (UNCHANGED, stays green)
```

Compass's keypair is loaded only when `COMPASS_STELLAR_SIGNER_ENABLED=true` and the network is testnet. Compass is one of the account's required signers; it contributes its signature and nothing else.

## Files

| File | Role |
| --- | --- |
| `back/services/stellar/signer/stellarCosignerContracts.ts` | NEW. Multi-signer-aware `CosignAdapter` contract that generalizes the single-signer `SignerAdapter`; operates on a base64 `TransactionEnvelope` XDR string. Result/refusal types, `CosignConfig`, `AccountSignerState` shape for Stellar. |
| `back/services/stellar/signer/stellarCosigner.ts` | NEW. Implements Wave 0's `ChainAdapter.cosign` + `inspectAccount` for Stellar: env-gated testnet keypair, candidate binding, ALLOW-gated single-signature add, Horizon signer/threshold read. |
| `back/services/stellar/signer/__tests__/stellarCosigner.test.ts` | NEW. Tests for binding, ALLOW/DENY/ESCALATE gating, only-own-signature, never-submit, testnet guard, and `inspectAccount` shape. |

No existing file is modified by this wave's deliverables; the Solana `signerAdapter*` files under `back/services/support/signer/` are left untouched.

## Contracts

The Stellar co-signer is a new, generalized contract — it is **not** typed on `VersionedTransaction`; it works on opaque base64 XDR so the brain seam stays chain-neutral.

```ts
import type { AccountSignerState } from "@shared/chainContracts"; // Wave 0
import type { CompassDecision } from "@shared/executionGatewayContracts";

/** Opaque base64-encoded Stellar TransactionEnvelope XDR. */
export type EnvelopeXdr = string;

/** The evaluated candidate, with the fingerprint cosign binds against. */
export type CosignCandidate = {
  candidateId: string;
  /** Hash over the envelope's signature-base / operations (see Behavior). */
  fingerprint: string;
};

export type CosignConfig = {
  /** Compass's own testnet secret seed; falls back to env. Never the user's key. */
  localSecretSeed?: string;
  /** Network passphrase used for signing; testnet-only guard applies. */
  networkPassphrase?: string;
};

export type CosignResult =
  | { ok: true; signedEnvelopeXdr: EnvelopeXdr; signerAddress: string }
  | { ok: false; reason:
        | "POLICY_NOT_ALLOWED"          // DENY or unresolved ESCALATE
        | "ENVELOPE_CANDIDATE_MISMATCH" // binding failed
        | "COMPASS_SIGNER_NOT_CONFIGURED"
        | "COMPASS_SIGNER_MAINNET_FORBIDDEN" };

/** Generalizes the single-signer SignerAdapter for native multisig. */
export interface CosignAdapter {
  /** Compass's own public address (G...). Never the user's. */
  getAddress(): Promise<string>;
  /** Add ONLY Compass's signature on ALLOW + matching binding. Never submits. */
  cosign(
    envelopeXdr: EnvelopeXdr,
    candidate: CosignCandidate,
    decision: CompassDecision,
  ): Promise<CosignResult>;
  /** Read real signers/weights/thresholds from Horizon. */
  inspectAccount(address: string): Promise<AccountSignerState>;
}
```

`AccountSignerState` (from Wave 0) carries the account's signers with weights and the `low` / `med` / `high` thresholds, so callers can prove that Compass's weight is required to meet the threshold.

## Behavior

`cosign(envelopeXdr, candidate, decision)`:

1. **Configuration / network guard.** If `COMPASS_STELLAR_SIGNER_ENABLED !== "true"` or no Compass seed is resolvable, return `COMPASS_SIGNER_NOT_CONFIGURED`. If the network passphrase / Horizon target is mainnet, return `COMPASS_SIGNER_MAINNET_FORBIDDEN`. Testnet only.
2. **Binding.** Decode the envelope (Wave 2) and compute its fingerprint over the deterministic signature-base / operation set. If it does not equal `candidate.fingerprint`, return `ENVELOPE_CANDIDATE_MISMATCH` and sign nothing. This closes the gap the Solana flow leaves open: the existing single-signer path has no in-signer binding between the evaluated action and the bytes signed; Stellar closes it here.
3. **Policy gate.** If `decision !== ALLOW` (i.e. `DENY` or unresolved `REQUIRE_HUMAN_APPROVAL`), return `POLICY_NOT_ALLOWED` and add no signature.
4. **Sign — own signature only.** Load Compass's testnet keypair, add **only** Compass's signature to the decoded envelope (the user's existing signature, if present, is preserved; Compass never replaces or strips it), re-encode, and return the augmented base64 XDR. Compass never holds or uses the user's key.
5. **Never submit.** `cosign` returns the augmented XDR and stops. Submission is the user's or the network's responsibility.

`inspectAccount(address)`:

- Reads the account from Horizon (Wave 1 connectivity) and maps its `signers` (key + weight) and `thresholds` (`low_threshold`, `med_threshold`, `high_threshold`) into `AccountSignerState`. Read-only; no signing.
- Lets the demo prove that the sum of the user's master weight plus Compass's signer weight is what meets the threshold, so removing Compass's signature leaves the threshold unmet.

Fingerprint definition: a SHA-256 over the canonical, deterministic representation of the envelope's operations and source/sequence used for the signature base — the same material the brain evaluated in Waves 2-3 — so a byte-equivalent re-evaluation reproduces the candidate's fingerprint while any altered operation breaks the match.

## Tests

- `getAddress` returns Compass's testnet `G...` address derived from the configured seed, never the user's.
- `cosign` with `decision = ALLOW` and a matching fingerprint returns `ok: true` with an augmented XDR that contains exactly one additional signature (Compass's) and preserves the user's signature.
- `cosign` with `decision = DENY` returns `ok: false` `POLICY_NOT_ALLOWED` and adds no signature.
- `cosign` with an unresolved `REQUIRE_HUMAN_APPROVAL` returns `POLICY_NOT_ALLOWED`.
- `cosign` with a non-matching envelope fingerprint returns `ENVELOPE_CANDIDATE_MISMATCH` and signs nothing.
- `cosign` never calls a submit/send path (asserted via a spy / no Horizon submit invocation).
- With `COMPASS_STELLAR_SIGNER_ENABLED` unset, `cosign` returns `COMPASS_SIGNER_NOT_CONFIGURED`.
- With a mainnet network passphrase / Horizon target, `cosign` returns `COMPASS_SIGNER_MAINNET_FORBIDDEN`.
- `inspectAccount` maps Horizon signers/weights/thresholds into `AccountSignerState`; without Compass's weight the configured threshold is unmet.
- The secret seed never appears in results, audit metadata, or logs.
- No `legacy/` import appears in any new Wave 4 file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — `ChainAdapter.cosign` (optional method), `AccountSignerState`, the chain-neutral seam.
- `stellar-wave-1-stellar-connectivity` — testnet Horizon access used by `inspectAccount`.
- `stellar-wave-2-xdr-decoder` — decodes the base64 `TransactionEnvelope` XDR and yields the operations the fingerprint covers.
- `stellar-wave-3-operation-mapping` — produces the `CompassDecision` (`ALLOW` / `DENY` / `ESCALATE`) that `cosign` gates on.
- Solana `back/services/support/signer/signerAdapter*.ts` — left unchanged; Stellar adds a parallel, generalized contract rather than mutating the Solana one.

## Deferred

- Multisig account setup for the demo (master weight + Compass key summing to threshold) — Wave 6.
- Submission orchestration / execution confirmation beyond returning the augmented XDR.
- Production custody, mainnet support, non-testnet signers.
- Automated keeper / unattended co-signing.
- Soroban contract-invocation co-signing.
