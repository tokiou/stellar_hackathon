# Stellar Wave 7 — ZK proof hook (optional) functional spec

> **Status: PLANNED — OPTIONAL / EXPLORATORY.** This wave is a *differentiator* hook, not part of
> the core Compass thesis. It applies **only if** the hackathon brief makes zero-knowledge proofs a
> **central, judged criterion**. If ZK is not a judged requirement, a proof bolted on top of Compass
> would be **decorative**, and this wave must not be built. See `exploration.md` for the decision
> gate. Waves 0-6 (the policy-gated co-signer) stand entirely on their own without this.

Today there is **zero ZK** anywhere in the Compass codebase. The only "proof" code is
`hosted/onchain/onchainApproval.ts`, which is a Solana **guard-proof** (an on-chain approval attestation),
**not** zero-knowledge. The only "zero-knowledge" string in the repo is in a Solana dev skill reference
(`.opencode/skills/solana-dev/references/confidential-transfers.md`) about confidential transfers, which is
unrelated to Compass. This wave would be the first ZK work, and it is gated behind a hard decision.

## Business Problem

Compass's value is that it co-signs a Stellar transaction **only when the policy decision is ALLOW**
(Wave 4), where that decision is computed by the brain over the real decoded/simulated transaction
(Waves 2-3 and the judge-unblinding workstream, `docs/judge-unblinding/`). Today that decision and the
policy that produced it are **trusted because they came from Compass**, not because anyone can verify them.

If a hackathon judges ZK centrally, the natural — and only architecturally honest — property to prove is:

> **"Compass's signature corresponds to an evaluation that PASSED policy"** — i.e. prove that the co-signed
> transaction is **policy-compliant**, *without revealing the policy itself or the private inputs* (amounts,
> thresholds, mandate text).

This turns the policy decision from a trusted side-effect into a **verifiable, privacy-preserving
attestation**: a third party can confirm a compliant evaluation occurred and is bound to the exact
co-signed transaction, while the rules and the sensitive figures stay private.

## Goals

> All goals below are **speculative and gated** on the decision gate in `exploration.md`.

- Define, at spec level only, where a ZK proof would sit: **between** the brain's ALLOW decision (fed by
  Waves 2-3) **and** the co-signature (Wave 4), binding the attestation to the co-signed transaction.
- Specify the public/private split: **PUBLIC** = that a compliant evaluation occurred (and possibly the
  decision plus a commitment to the transaction); **PRIVATE** = the policy rules, amounts, and thresholds.
- Reuse the conceptual anchor of `docs/judge-unblinding/`: a proof would attest the judge/policy evaluation
  *result* without exposing the policy or the raw transaction facts.
- Keep the proof **off the critical path of the core thesis** — Solana keeps working unchanged, the brain
  stays untouched, and Waves 0-6 remain fully functional whether or not this hook exists.
- Record an explicit **decision-gate sign-off** before any implementation is allowed to start.

## Non-Goals

- **No production ZK system.** Any output of this wave is a demo/differentiator hook at best.
- **No claim that ZK is needed for the core co-signer thesis.** Waves 0-6 are complete without it.
- **No proving-system lock-in at spec time.** The choice of proving system is left open by design.
- No change to the brain (policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS`, MCP proxy).
- No change to any Solana provider or Solana signing behavior.
- No on-chain (Soroban) verifier commitment until the decision gate and an explicit verifier decision pass.
- No `legacy/` imports.

## User-Visible Scenarios

> These describe the *intended* behavior **if** the wave is built after the decision gate passes.

### A compliant co-signature carries a verifiable attestation

Given the brain returned `ALLOW` for a transaction whose real facts were decoded/simulated (Waves 2-3),
when Compass co-signs (Wave 4), then Compass also emits a ZK proof attesting that a **compliant policy
evaluation occurred over the committed transaction facts**, and the proof is bound to the co-signature.

### A verifier confirms compliance without learning the policy or amounts

Given the emitted proof and the public commitment to the transaction, when a verifier checks the proof,
then the verifier learns **only** that a compliant evaluation occurred (and, if chosen, the decision),
and learns **nothing** about the policy rules, the amounts, or the thresholds.

### The proof cannot be reused for a different transaction

Given a proof bound to one co-signed transaction, when the proof is presented alongside a *different*
transaction, then verification **fails**, because the public commitment does not match.

### ZK is absent and Compass still works

Given the decision gate did **not** pass (ZK is not a judged criterion), when Compass co-signs on ALLOW,
then no proof is emitted and the co-signer thesis (Waves 0-6) is **fully functional and unchanged**.

## Acceptance Criteria

> **Speculative and gated.** None of these may be pursued before the decision-gate sign-off is recorded.

- A verifiable proof ties an `ALLOW` decision to a co-signature **without exposing the policy or the
  private amounts/thresholds**.
- The proof is **bound to the exact transaction** Compass co-signed (a commitment mismatch fails verification).
- A **documented verifier** exists (where it runs, what it checks, what it learns) — even if off-chain only.
- An explicit **decision-gate sign-off** is recorded in this wave **before** any implementation begins.
- Solana behavior is unchanged and the brain is untouched.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

No test results are claimed: this wave is planned and optional, and no implementation exists.

## Dependencies

- `stellar-wave-3-operation-mapping` — produces the mapped facts and policy context the proof would attest over.
- `stellar-wave-4-cosigning-multisig` — produces the co-signature the proof would be bound to.
- Conceptual anchor: `docs/judge-unblinding/` — the "decode/simulate -> judge on the real tx" workstream is
  the closest existing precedent for attesting a policy/judge evaluation result over ground truth.

## Deferred To Later Waves

- Choice of proving system, circuit design, and prover infrastructure.
- Any on-chain (Soroban) verifier and its gas/cost characteristics.
- Production-grade trusted setup, key management, and proof distribution.
- Privacy posture of the policy (private vs. public-but-versioned) — see `exploration.md` open questions.
- Performance hardening against an interactive latency budget.
