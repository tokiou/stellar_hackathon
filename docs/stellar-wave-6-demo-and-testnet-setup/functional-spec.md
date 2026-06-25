# Stellar Wave 6 — Demo and testnet setup functional spec

Stellar Wave 6 makes the whole Stellar thesis reproducible from scratch on Testnet with a single guided script and runbook. Waves 1–5 built the pieces — connectivity, the XDR decoder, operation mapping into neutral facts, policy-gated co-signing over native multisig, and the multisig-aware audit trail. Wave 6 stitches them into one end-to-end demonstration: an operator with only the repository and public Testnet access runs one command, watches all six demo cases play out, and observes that without Compass's signature a transaction simply cannot meet the account threshold. This wave adds no new brain logic and changes no decision behavior; it is a reproducibility and packaging wave that wires the existing Stellar tools through the existing MCP proxy and drives them from a deterministic demo script.

## Business Problem

The Stellar thesis — "Compass is a policy-gated co-signer, and Stellar's native multisig makes the policy gate impossible to bypass" — is currently only provable by a developer who already understands the codebase, manually assembles a Testnet account, hand-configures signer weights and thresholds, and crafts each transaction. That is not a demo; it is tribal knowledge. To be credible (for judges, teammates, and future contributors) the claim must be reproducible by a stranger from a clean checkout in minutes, against the public Stellar Testnet, with no privileged access and no custom on-chain deployment. The Solana side of the product already has this property via `docs/wave-8-demo-hardening/` (a runbook plus a hardened demo path); Stellar has the working primitives but no equivalent single-command, observable, reproducible demonstration. Wave 6 closes that gap and, in doing so, surfaces the central "why Stellar" win: the multisig guarantee is native, so the demo needs no Anchor program and no contract deploy step.

## Goals

- Provide a single guided demo script (planned: `scripts/stellar-demo.mjs`) that runs the full Stellar thesis end-to-end from a clean state.
- Create and fund a fresh Testnet account via Friendbot (reusing the Wave 1 helper) so the demo starts from nothing the operator has to pre-provision.
- Configure that account's native multisig with a `setOptions` operation so the master/user weight plus Compass's key sum to the medium threshold — meaning that **without** Compass's signature the threshold is **not** met. This configuration is what proves the thesis.
- Drive all six demo cases end-to-end and print, for each, the decision (ALLOW / DENY / ESCALATE), the observable on-network outcome, and an audit summary (Wave 5).
- Expose the Stellar tools **through the existing MCP proxy** without modifying the proxy core, so the demo exercises the real routed surface.
- Write an operator runbook (`runbook.md`) covering prerequisites, env vars, account creation and funding, multisig configuration, and each demo case with its expected observable outcome.
- Call out explicitly that no custom on-chain contract is required (native Stellar multisig) as the reproducibility win versus the Solana Anchor-program setup.

## Non-Goals

- No change to Solana — the Solana demo (`docs/wave-8-demo-hardening/`) keeps working unchanged.
- No change to the brain: policy engine, LLM judge, decision sanitizer, and `COMPASS_DECISIONS` semantics stay untouched.
- No change to the MCP proxy core — Stellar tools are exposed *through* the already chain-agnostic proxy, not by modifying it.
- No new decision logic, new policy, or new risk classification — Wave 6 only orchestrates existing Wave 1–5 behavior.
- No mainnet readiness and no real-funds path — Testnet only, Friendbot-funded.
- No persistent demo infrastructure, hosted endpoint, or CI integration — local, on-demand reproducibility only.
- No `legacy/` imports.

## User-Visible Scenarios

These are operator- and system-visible outcomes. The "user" signature in the automated demo is represented by a second Testnet keypair acting as the user/master signer (see Verification / openQuestions).

### One command reproduces the full thesis from a clean state

Given only the repository and public Testnet access, when the operator runs the planned `scripts/stellar-demo.mjs`, then the script creates and funds a fresh Testnet account via Friendbot, configures its multisig so Compass is a required signer, runs all six demo cases, and prints a per-case table of decision plus observable on-network outcome plus audit summary.

### A legit in-policy payment is allowed and executes

Given the configured account, when the demo drives Case 1 (a legit payment within policy), then the brain returns ALLOW, Compass co-signs, the combined weight meets the threshold, and the transaction executes on Testnet.

### A payment to a non-allowlisted destination is denied

Given the configured account, when the demo drives Case 2 (payment to a non-allowlisted destination), then the brain returns DENY, Compass does **not** sign, the threshold is unmet, and the transaction is not executable.

### An out-of-range amount escalates

Given the configured account, when the demo drives Case 3 (amount out of range), then the brain returns ESCALATE (`REQUIRE_HUMAN_APPROVAL`) and Compass does not auto-sign.

### A critical operation escalates

Given the configured account, when the demo drives Case 4 (a critical operation such as `setOptions` or `changeTrust`), then the brain returns ESCALATE.

### A user-only signature cannot reach threshold

Given the configured account, when the demo drives Case 5 (the user signs but Compass does **not** sign), then the threshold is unmet and the network rejects the transaction — it is not executable. This is the structural proof of the thesis.

### A user-plus-Compass signature is executable

Given the configured account, when the demo drives Case 6 (user signs and Compass also signs on an ALLOW), then the combined weight meets the threshold and the transaction is executable.

## Acceptance Criteria

- The demo is reproducible from a clean state via the documented planned script.
- The Testnet account multisig is configured so Compass is a required signer (master/user weight + Compass key sum to the medium threshold; Compass alone or user alone is below threshold).
- All six demo cases produce the expected decision and the expected observable on-network outcome.
- Each of the six cases leaves an audit record (Wave 5).
- The Stellar tools are listed via the existing MCP proxy without modifying the proxy core.
- The brain is untouched and the Solana demo still works.
- No `legacy/` imports are introduced.
- No custom on-chain contract is deployed — the multisig guarantee is native Stellar.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`
- Manual: run the planned `scripts/stellar-demo.mjs` from a clean state and confirm all six cases print the expected decision and observable outcome.
- Manual: call `tools/list` through the existing MCP proxy and confirm the Stellar tools appear without proxy-core changes.
- Manual: confirm `inspectAccount` (Wave 4) reports signers/weights/thresholds such that Compass is required.

## Dependencies

- `stellar-wave-1-stellar-connectivity` — Friendbot helper, network config, and Horizon/RPC connectivity used to create, fund, and submit on Testnet.
- `stellar-wave-2-xdr-decoder` — decodes the demo envelopes into neutral `SemanticFacts` for the brain.
- `stellar-wave-3-operation-mapping` — maps decoded operations into the `actionKind` / `riskClass` / context the brain evaluates.
- `stellar-wave-4-cosigning-multisig` — `cosign`, `inspectAccount`, and the native-multisig threshold guarantee that the demo exercises.
- `stellar-wave-5-audit-trail-multisig` — the audit records each demo case must leave.

## Deferred To Later Waves

- Mainnet readiness and any real-funds demo path.
- Hosted or CI-driven continuous demo execution.
- A frontend/UI walkthrough of the six cases (script + runbook only here).
- Production custody and key-management hardening for the Compass signer.
- Multi-account or multi-asset demo matrices beyond the six core cases.
