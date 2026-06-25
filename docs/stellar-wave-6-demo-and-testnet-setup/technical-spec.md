# Stellar Wave 6 — Demo and testnet setup technical spec

Stellar Wave 6 adds a deterministic demo orchestrator that drives the Wave 1–5 Stellar primitives end-to-end on the public Testnet, plus an operator runbook. It introduces no new brain logic, no new policy, and no new decision behavior; it composes existing services. The only new code is a demo script (planned: `scripts/stellar-demo.mjs`) modeled on the existing `scripts/e2e-pipeline-test.mjs` and `scripts/test-user-flow.mjs`, and any small demo-only helpers it needs. The Stellar tools are exercised **through the existing MCP proxy** — the proxy is already chain-agnostic, so no proxy-core file changes.

## Architecture

```txt
operator (one command)
  │  node scripts/stellar-demo.mjs            [PLANNED]
  ▼
stellar-demo.mjs  (orchestrator, demo-only)
  ├─ 1. createAndFund()  ── Friendbot helper (Wave 1: stellar/providers/friendbot.ts)
  │        ├─ user/master keypair  (acts as the "user" signer)
  │        └─ Compass cosigner key (from env / Wave 4 signer)
  ├─ 2. configureMultisig()  ── setOptions op via Wave 1 connection + Wave 4 submit
  │        master weight + Compass key  ==  medium threshold
  │        (Compass alone < threshold; user alone < threshold)
  │        verify with StellarChainAdapter.inspectAccount()  (Wave 4)
  └─ 3. runCase(1..6)  for each of the six demo cases:
           build envelope ─▶ MCP proxy (tools/list + call)  ─┐  [unchanged proxy core]
                                                             ▼
              StellarChainAdapter.decode (W2) ─▶ operation map (W3)
                       ▼
              brain: policy + judge + sanitizer (UNTOUCHED) ─▶ ALLOW/DENY/ESCALATE
                       ▼
              StellarChainAdapter.cosign (W4)  ── signs only on ALLOW
                       ▼
              submit to Horizon (W1) ─▶ observable on-network outcome
                       ▼
              audit record (W5) ─▶ printed summary table
```

## Files

| File | Status | Purpose |
| --- | --- | --- |
| `scripts/stellar-demo.mjs` | PLANNED (new) | Demo orchestrator: create+fund account, configure multisig, drive all six cases, print decision + on-network outcome + audit summary. |
| `scripts/stellar-demo-cases.mjs` | PLANNED (new, optional) | Declarative table of the six case definitions (envelope shape, expected decision, expected outcome) consumed by the orchestrator. |
| `docs/stellar-wave-6-demo-and-testnet-setup/runbook.md` | PLANNED (new) | Operator guide: prerequisites, env vars, numbered steps, expected observable outcome per step. |
| `back/services/stellar/providers/friendbot.ts` | EXISTING (Wave 1) | Reused to create and fund Testnet accounts; not modified. |
| `back/services/stellar/providers/stellarNetworkConfig.ts` | EXISTING (Wave 1) | Network passphrase / Horizon / RPC / Friendbot config; not modified. |
| `back/services/stellar/stellarChainAdapter.ts` | EXISTING (Wave 2/4) | `decode`, `cosign`, `inspectAccount`, `submit` driven by the demo; not modified. |
| MCP proxy core | EXISTING | Stellar tools exposed *through* it; not modified. |
| brain (policy/judge/sanitizer) | EXISTING | Untouched. |

## Contracts

The demo introduces no new exported runtime contracts. It consumes existing ones and defines demo-only local shapes for orchestration and reporting:

```ts
// Demo-only (local to scripts/, not a shared contract)
type StellarDemoCase = {
  id: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  // how the case builds its transaction envelope on the funded account
  buildEnvelope: (ctx: DemoContext) => Promise<string>; // base64 XDR
  userSigns: boolean;     // does the user/master key sign?
  expectedDecision: "ALLOW" | "DENY" | "ESCALATE";
  expectedOutcome: "executable" | "not_executable" | "not_submitted";
};

type DemoContext = {
  userKeypair: unknown;     // second Testnet keypair = the "user"/master signer
  accountId: string;        // the funded, multisig-configured Testnet account
  compassSigner: string;    // Compass cosigner public key
};

type StellarDemoCaseResult = {
  id: number;
  decision: "ALLOW" | "DENY" | "ESCALATE";
  observedOutcome: "executable" | "not_executable" | "not_submitted";
  matchedExpectation: boolean;
  auditId: string | null;   // Wave 5 audit record id
};
```

## Behavior

- **Create + fund (step 1).** The orchestrator generates a user/master keypair and funds the account via the Wave 1 Friendbot helper against `STELLAR_FRIENDBOT_URL`. The Compass cosigner key is taken from the Wave 4 signer configuration / env, never generated fresh, so the gate is the real Compass key.
- **Configure multisig (step 2).** A `setOptions` operation sets signer weights and the low/medium/high thresholds so that master weight + Compass weight equals the medium threshold, and neither signer alone reaches it. The orchestrator then calls `inspectAccount` (Wave 4) and asserts Compass is genuinely required before running any case. If the assertion fails, the demo aborts with a clear error rather than producing misleading results.
- **Run cases (step 3).** For each case the orchestrator builds the case envelope, routes it through the existing MCP proxy (`tools/list` then a tool call), lets the unchanged brain decide, and lets Wave 4 `cosign` sign only on ALLOW. It then submits (or, for the DENY/ESCALATE non-signing cases, attempts submission with the available signatures) and records the observable on-network outcome.
- **Cases 1–6** map directly to the functional spec: (1) ALLOW + executes, (2) DENY + not executable, (3) ESCALATE out-of-range, (4) ESCALATE critical op, (5) user-only signature → threshold unmet → network rejects, (6) user + Compass → executable.
- **Reporting.** The orchestrator prints a verdict table (case id, expected vs observed decision, observable outcome, audit id) in the style of `scripts/e2e-pipeline-test.mjs`, and exits non-zero if any case fails to match expectation.
- **Proxy + brain invariants.** No proxy-core file is touched; Stellar tools appear via `tools/list` because they are registered through the existing chain-agnostic registry. The brain code is not modified.
- **Native-multisig win.** Because the threshold guarantee is enforced by Stellar consensus, there is no contract deploy step — the runbook notes this as the reproducibility advantage over the Solana Anchor-program path.

## Tests

- This is a planning wave; no test results are claimed.
- Existing Wave 1–5 backend tests must continue to pass unchanged (`npm run test:back`).
- The demo script is exercised manually per the runbook (it depends on live public Testnet + Friendbot and is therefore not added to the automated unit suite).
- If demo-only helpers with pure logic are extracted (e.g. case-definition validation), they may carry focused unit tests under `scripts/` or `back/`; any such tests are added RED-first and are not asserted as passing in this spec.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`
- Manual: run the planned `scripts/stellar-demo.mjs` from a clean state; confirm all six cases match expectation and each emits an audit record.
- Manual: `tools/list` through the existing MCP proxy shows the Stellar tools with no proxy-core diff.

## Dependencies

- `stellar-wave-1-stellar-connectivity` — Friendbot helper, network config, Horizon/RPC connection.
- `stellar-wave-2-xdr-decoder` — envelope → `SemanticFacts`.
- `stellar-wave-3-operation-mapping` — neutral facts → `actionKind` / `riskClass` / context.
- `stellar-wave-4-cosigning-multisig` — `cosign`, `inspectAccount`, `submit`, native-multisig threshold.
- `stellar-wave-5-audit-trail-multisig` — audit records for each case.

## Deferred

- Mainnet readiness and real-funds demo paths.
- Hosted/CI continuous demo execution.
- Frontend/UI walkthrough of the cases.
- Production custody / key-management hardening for the Compass signer.
- Demo matrices beyond the six core cases (multi-account, multi-asset).
