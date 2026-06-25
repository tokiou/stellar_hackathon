# Stellar Wave 7 — ZK proof hook (optional) technical spec

> **Status: PLANNED — OPTIONAL / EXPLORATORY.** Everything in this document is **speculative**. No code
> exists, no proving system is chosen, and nothing here may be implemented before the decision gate in
> `exploration.md` passes and a sign-off is recorded. This spec describes *where a ZK hook would attach*
> and *what it would attest*, deliberately without committing to a cryptographic stack. The core Compass
> thesis (Waves 0-6, the policy-gated co-signer) is complete and ships without any of this.

There is **zero ZK** in Compass today. `hosted/onchain/onchainApproval.ts` is a Solana guard-proof (an
on-chain approval attestation), **not** zero-knowledge. The lone "zero-knowledge" mention lives in
`.opencode/skills/solana-dev/references/confidential-transfers.md` and is unrelated to Compass.

## Architecture

The proof sits **between** the brain's decision and Wave 4's co-signature, binding the two together. It is
strictly additive — removing it returns the flow to the unchanged Wave 4 path.

```txt
  Waves 2-3                  Brain (UNTOUCHED)            Wave 7 (OPTIONAL, gated)        Wave 4
  XDR decode +   ───────►   policy engine + LLM   ──┐                                   cosign(envelopeXdr)
  operation map             judge over real tx      │                                   on ALLOW only
  (ground truth)            => ALLOW / DENY / ESC    │                                       │
        │                                            │                                       ▼
        │                                            ▼                                   augmented XDR
        │                              ┌─────────────────────────────┐                  + (optional) proof
        └──── tx facts (PRIVATE) ─────►│  ZK prover (speculative)     │                      │
                                       │  PRIVATE: policy rules,      │                      │
              policy rules (PRIVATE) ─►│  amounts, thresholds         │                      ▼
                                       │  PUBLIC: "compliant eval     │              ┌───────────────┐
                                       │  occurred" + tx commitment   │──── proof ──►│   Verifier    │
                                       │  + (maybe) decision          │              │ off-chain or  │
                                       └─────────────────────────────┘              │ Soroban (TBD) │
                                                                                     └───────────────┘
                                 proof is BOUND to the same tx commitment the co-signature covers
```

If ZK is not a judged criterion, the entire middle/right column is absent and the diagram collapses to the
unchanged Wave 4 flow.

## Files

> All planned/speculative. None exist. Names are placeholders to show shape, not committed paths.

| File (speculative)                                         | Purpose                                                            |
|------------------------------------------------------------|--------------------------------------------------------------------|
| `back/services/zk/zkAttestationContracts.ts`               | Types only: proof request, public inputs, proof artifact, result. |
| `back/services/zk/policyComplianceAttestor.ts`             | Speculative attestor: builds the public commitment, requests proof.|
| `back/services/zk/zkVerifier.ts`                           | Speculative off-chain verifier (location is an open question).     |
| `back/services/zk/__tests__/policyComplianceAttestor.test.ts` | Behavior tests (commitment binding, fail-on-mismatch).          |
| `docs/stellar-wave-7-zk-hook/exploration.md`               | The honest exploration + decision gate (this wave).                |

## Contracts

> **Speculative TypeScript interfaces** — illustrative shape only, not a committed API. They intentionally
> avoid naming any proving system, curve, or circuit format.

```ts
// What is committed publicly to bind the proof to the exact co-signed transaction.
// The concrete commitment scheme is an OPEN question (see exploration.md).
interface TxCommitment {
  // e.g. a hash/commitment over the canonical TransactionEnvelope XDR fingerprint.
  readonly transactionFingerprint: string;
  readonly chain: "stellar";
}

// Private witness fed to the prover. NEVER serialized into the proof or any public output.
interface PolicyComplianceWitness {
  readonly policyRules: unknown;     // PRIVATE: the policy itself
  readonly amounts: unknown;         // PRIVATE: transfer amounts
  readonly thresholds: unknown;      // PRIVATE: caps / multisig thresholds
  readonly decodedFacts: unknown;    // PRIVATE: decoded/simulated tx facts (Waves 2-3)
}

// Public statement the verifier checks.
interface PolicyCompliancePublicInputs {
  readonly commitment: TxCommitment;        // binds proof to the co-signed tx
  readonly decisionPublic?: "ALLOW";        // OPEN: expose the decision, or only "compliant occurred"?
}

interface ZkProofArtifact {
  readonly system: string;          // OPEN: which proving system; intentionally unbound here
  readonly proof: string;           // opaque proof bytes (encoding TBD)
  readonly publicInputs: PolicyCompliancePublicInputs;
}

interface PolicyComplianceAttestor {
  // Build the proof AFTER the brain returns ALLOW and BEFORE/at Wave 4 co-signature.
  attest(witness: PolicyComplianceWitness, commitment: TxCommitment): Promise<ZkProofArtifact>;
}

interface ZkVerifier {
  // Returns true only if the proof is valid AND its commitment matches the presented tx.
  verify(proof: ZkProofArtifact, commitment: TxCommitment): Promise<boolean>;
}
```

## Behavior

- The attestor runs **only on a brain `ALLOW`** and only after the real facts are available (Waves 2-3).
- The proof's `commitment` MUST equal the fingerprint of the envelope Wave 4 co-signs. A mismatch is a hard
  failure — no proof is emitted for a transaction that differs from the evaluated one.
- The private witness (policy, amounts, thresholds, decoded facts) MUST never appear in any public output,
  log, or audit metadata.
- If the prover is unavailable or over budget, the hook is **fail-open for the proof but never for the
  decision**: absence of a proof must not turn a DENY into an ALLOW, and must not block the co-signer thesis.
- Verification is binary and side-effect-free: it confirms a compliant evaluation occurred and is bound to
  the tx, nothing more.

## Tests

> Planned only; none written. No results claimed.

- Commitment binding: a proof built for tx A fails verification when presented with tx B's commitment.
- Privacy: no element of the witness (policy/amounts/thresholds) appears in `ZkProofArtifact` or public inputs.
- Gating: the attestor is never invoked on `DENY` or unresolved `ESCALATE`.
- Isolation: removing the hook leaves the Wave 4 co-signing tests green and Solana paths unchanged.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Open Design Risks

- **Decorative risk (primary).** If ZK is not judged centrally, this is cryptographic theater bolted on a
  system that already works. The decision gate exists to refuse exactly this.
- **Proving cost/latency.** A real prover may dwarf any interactive budget (the codebase already reasons in
  terms of an `COMPASS_LLM_TIMEOUT_MS`-style budget); proving in-band could be infeasible.
- **Circuit honesty.** Encoding the real policy engine + LLM judge as a circuit is hard; a toy circuit would
  prove a *toy* policy, not the real one — risking a misleading "we have ZK" claim.
- **Verifier trust.** An off-chain verifier moves trust rather than removing it; a Soroban verifier adds
  on-chain cost and a new attack surface.
- **Privacy scope creep.** Deciding what is public (decision? commitment?) leaks information if done carelessly.

## Dependencies

- `stellar-wave-3-operation-mapping` — the ground-truth facts the proof attests over.
- `stellar-wave-4-cosigning-multisig` — the co-signature the proof binds to.
- Conceptual anchor: `docs/judge-unblinding/` (proposal + technical-spec) — attesting a judge/policy
  evaluation result over the real tx is the nearest existing pattern.

## Deferred

- Proving-system selection, circuit construction, trusted setup, and key management.
- On-chain (Soroban) verifier and its cost model.
- Proof distribution/storage and any durable verdict-plus-proof store.
- Performance hardening and any in-band latency-budget integration.
- Policy privacy posture (fully private vs. public-but-versioned).
