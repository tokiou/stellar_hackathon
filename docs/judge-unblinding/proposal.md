# Judge Un-blinding — feed the judge the real transaction (proposal)

> **Status: DRAFT / proposal — the "judge" workstream the
> [demo-day plan](../compass-demo-day/proposal.md) depends on.**
> **Demo-day-critical. Same mid-July deadline.** Updated 2026-06-24, grounded in a read of this repo
> @ `release/compass_migration`. Meets the demo-day plan at the
> [Judge handoff contract](../compass-demo-day/proposal.md#judge-handoff-contract).
> Technical detail → [technical-spec.md](./technical-spec.md).

## TL;DR

Today the judge (deterministic policy + advisory LLM) decides on the agent's **self-reported arguments**,
not the real transaction. So a within-cap action that's outside the owner's mandate — the demo's headline
(**~$0 authority/approval escalation, Grok/Bankr**) — can't actually be caught. This workstream **un-blinds
the judge**: decode + simulate the real tx and judge on ground truth. It is the load-bearing piece of the
demo's "mandate-stop" moment.

## The problem (grounded in code)

- `evaluationService.derivePolicyContext` builds `context.flags.authority_change` via
  `readBoolean(args, ["authority_change"])` — **the agent's own claim**.
- `policyEngine.evaluateBlockedFlags` then trusts those flags.
- The LLM judge gets `rawContext: request.arguments` — **the same self-report**, plus the policy verdict.
- **0** `simulateTransaction` calls in the repo; `REQUIRE_SIMULATION` currently just fails closed.

⇒ A compromised/injected agent that doesn't self-incriminate (`authority_change` omitted) passes **every**
layer. *"The mandate, not the amount"* is sold but not yet implemented — the danger lives in the transaction,
which nothing currently reads.

## Two principles this encodes

1. **Deny vs. approve asymmetry** — deterministic rules are sound for *blocking* but not *complete*, so a
   deterministic **deny is final**; a deterministic **pass escalates** to the LLM. *(Rama's criterion.)*
2. **Input fidelity** — that escalation is only worth anything if the judge sees the **real decoded/simulated
   tx**. The asymmetry *requires* it: if the LLM owns every approval, the approve-path is only as good as what
   the LLM can see. Self-reported args ⇒ rubber-stamp by a blind judge.

## Scope

**In scope:** transaction decode + simulate as a guard step; derive policy `flags` from ground truth (not
args); feed the judge the decoded/simulated action **and** `userIntent` (the mandate, captured today but never
passed); latency budget + fail-closed; observe-first rollout.

**Out of scope (demo-day plan owns it):** plug & play install, approval UI, durable verdict store, demo
assembly. We connect only at the [handoff contract](../compass-demo-day/proposal.md#judge-handoff-contract).

## Why it beats CrabTrap

CrabTrap (Brex, MIT) is **LLM-on-real-action only**. This is **deterministic deny (cheap, fast,
injection-proof) in front of LLM-on-real-action**. Same ground-truth judging CrabTrap has, *plus* a fail-fast
deterministic layer they lack — once the judge sees the real tx. The decode/simulate step is what makes our
hybrid strictly stronger than CrabTrap, not weaker.

## Demo-day dependency (read with the demo-day plan)

The demo headline — *"an action caps would pass but is outside the owner's mandate gets stopped, with a
plain-English reason"* — is **impossible without this workstream**. The demo-day plan delivers everything
*around* the judge; this delivers the judge it depends on. **Plumbing-ready and judge-ready must land by the
same mid-July date** — the handoff contract pins the interface; this is the reminder it must also pin the
*timing*.
