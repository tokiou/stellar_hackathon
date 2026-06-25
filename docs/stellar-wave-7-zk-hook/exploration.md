## Exploration: stellar-wave-7-zk-hook (OPTIONAL / EXPLORATORY)

### Honest starting point

Compass has **zero** zero-knowledge anywhere today. The only "proof" in the repo is
`hosted/onchain/onchainApproval.ts`, a Solana on-chain **guard-proof** (an approval attestation), which is
not zero-knowledge at all. The single "zero-knowledge" string in the codebase is in a Solana dev skill
reference (`.opencode/skills/solana-dev/references/confidential-transfers.md`) about confidential transfers,
unrelated to Compass. So this wave is not "improving" existing ZK — it would be the **first** ZK work, built
on top of a system (Waves 0-6) that already delivers its full thesis without it.

### What we would prove (the only honest property)

The property that fits Compass's architecture is:

> **"Compass's signature corresponds to an evaluation that PASSED policy."**

That is: prove the co-signed transaction is **policy-compliant** without revealing the policy or the private
inputs. PUBLIC = a compliant evaluation occurred (and maybe the decision + a tx commitment). PRIVATE = the
policy rules, the amounts, the thresholds, the decoded facts. The proof sits between the brain's ALLOW
(Waves 2-3) and the Wave 4 co-signature, bound to the exact transaction. The closest conceptual anchor we
already have is `docs/judge-unblinding/`: it un-blinds the judge so the decision is made over the real tx —
a ZK proof would attest *that* evaluation's result without exposing the policy or the raw tx.

### Candidate approaches (conceptual only — no system chosen)

1. **Prove a policy circuit over committed inputs.** Express the deterministic policy checks (caps,
   blocked-flag rules) as a circuit; commit to the tx facts; prove "rules held => ALLOW" with rules/amounts
   private. *Plausible for the deterministic layer; the LLM judge is not circuit-friendly.*
2. **Attest only the deterministic deny-path, not the LLM approve-path.** Per the judge-unblinding asymmetry
   (deny is final, pass escalates to the LLM), a circuit could honestly prove the *deterministic* portion and
   simply state that the LLM advisory step ran — narrower but not misleading.
3. **Commitment-only attestation (weakest).** Skip a real circuit; publish a commitment + a signature that "an
   evaluation occurred." This is essentially **decorative** — it proves Compass said so, not that it is true.

### The big unknowns (genuinely open)

- **Which proving system.** Unbound on purpose. Trade-offs (setup, proof size, prover time, tooling maturity)
  are unresolved and depend on what a judge would actually value.
- **Prover cost vs. budget.** Compass reasons about interactive budgets (an `COMPASS_LLM_TIMEOUT_MS`-style
  envelope). A real prover may not fit in-band; it might have to run async/out-of-band, changing the UX claim.
- **Who verifies, and where.** Off-chain verifier (moves trust, cheap) vs. Soroban on-chain verifier (stronger
  story, real cost + new attack surface). Unresolved.
- **What exactly binds the tx.** The commitment scheme (hash over the canonical envelope fingerprint vs.
  something richer) is undecided.
- **Policy privacy posture.** Must the policy stay private, or is "public-but-versioned" acceptable? If the
  policy can be public, much of the ZK motivation evaporates.

### Decorative vs. essential test

Ask one question: **does the hackathon brief judge ZK as a central criterion?**

- If **no**: a proof here is **decorative**. It adds cryptographic ceremony to a system whose guarantee
  already comes from Stellar-native multisig + the policy-gated co-signer. Do **not** build it. Spending the
  demo budget here weakens, not strengthens, the core story.
- If **yes**: it becomes **essential to scoring**, and the honest version (approaches 1/2, attesting the real
  deterministic policy with private inputs, bound to the co-signature) is worth the cost. Approach 3 is never
  acceptable as a headline claim — it would be theater.

### Decision gate (hard rule)

**Do not build this wave unless the hackathon brief makes ZK a judged/central criterion, and a sign-off is
recorded in `task.json` before any implementation starts.** Recommendations, not decisions, on the open
questions above; they are resolved only if and when the gate opens. Until then, Waves 0-6 are the deliverable
and this wave stays planned, optional, and unbuilt.

### Ready for implementation?

**No.** Ready only as a gated, optional plan. Implementation is blocked on the decision gate above.
