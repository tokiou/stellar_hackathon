# Stellar Wave 3 — Operation mapping and policy context functional spec

Stellar Wave 3 adds a thin mapping layer that translates Stellar's native operation types into the `actionKind` and `riskClass` vocabulary the existing Compass policy engine already understands, and derives the policy-context object the engine already consumes. The brain (policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS` contract) stays untouched. Solana keeps working unchanged in parallel. This wave is decision-only: it does not sign, submit, or execute anything; it only teaches the mapping layer what each Stellar operation means in risk terms so the existing engine can decide.

## Business Problem

Compass classifies risk today by tokenizing tool **names** (`back/services/mcp/proxy/mcpProxyPolicyInterceptor.ts`) and deriving a policy context in `hosted/evaluate/evaluationService.ts`. The brain reasons over `actionKind` (e.g. `transfer`, `swap`), `riskClass` (from `TOOL_RISK_CLASSES`), and a `PolicyEvaluationContext` (amount, recipient, flags).

The brain has no knowledge of Stellar's native operation types (`payment`, `changeTrust`, `setOptions`, `createAccount`, `manageData`, `manageSellOffer`, etc.). After Wave 2 decodes a Stellar transaction envelope into a structured list of operations, those operations cannot be evaluated until something maps them onto the brain's existing vocabulary. Without that mapping, a critical operation such as `changeTrust` (open a trustline) or `setOptions` (change signers/thresholds — the very mechanism the co-signer relies on) would be invisible to policy.

Wave 3 closes that gap by adding a mapping layer only. It does not change how the engine scores or decides.

## Goals

- Add a complete, explicit operation map: every Stellar operation type resolves to an `actionKind` and a `riskClass` from the existing `TOOL_RISK_CLASSES`.
- Map value-movement operations (`payment`, `pathPaymentStrictSend`, `pathPaymentStrictReceive`) to `actionKind: "transfer"`, `riskClass: SENSITIVE_EXECUTION`, so the existing policy engine evaluates them by amount and destination.
- Force critical operations (`changeTrust`, `setOptions`) to escalate to `REQUIRE_HUMAN_APPROVAL` (ESCALATE) regardless of amount.
- Derive the policy context the engine already consumes (`amount_usd`, `recipient_address`, `recipient_known`) from decoded operations, extended **additively** with Stellar-relevant flags (`changes_trustline`, `changes_signers`).
- Handle multi-operation envelopes: if **any** operation is critical, the whole envelope escalates.
- Fail closed: any unmapped or future operation type defaults to escalation / `BLOCKED_UNKNOWN`.
- Cover the behavior with backend tests.

## Non-Goals

- No change to the policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS` contract, or MCP proxy decision logic (the brain stays untouched).
- No new decision types; reuse the existing `COMPASS_DECISIONS`.
- No removal or renaming of existing `PolicyEvaluationContext` fields (flags are additive only).
- No changes to any Solana provider or Solana behavior.
- No signing, submission, simulation, or co-signer/threshold logic (later waves).
- No XDR decoding (Wave 2 owns that; Wave 3 consumes its output).
- No mainnet support of any kind.
- No `legacy/` imports.

## User-Visible Scenarios

All four scenarios are resolved by the **existing brain** once the mapping layer feeds it the correct `actionKind`, `riskClass`, and context. The mapping layer adds no new decisioning.

### Legitimate payment within policy is allowed

Given a decoded Stellar envelope with a single `payment` operation to an allowlisted recipient and an amount within policy, when Compass maps it to `transfer` / `SENSITIVE_EXECUTION` and derives the context, then the existing policy engine returns `ALLOW`.

### Payment to a non-allowlisted destination is denied

Given a decoded `payment` to a recipient that is not on the allowlist (`recipient_known: false`), when the mapping layer derives `recipient_address` / `recipient_known` and the engine evaluates it, then the existing policy engine returns `DENY`.

### Payment amount out of range escalates

Given a decoded `payment` whose `amount_usd` is outside the configured policy range, when the engine evaluates the mapped action, then it returns `REQUIRE_HUMAN_APPROVAL` (ESCALATE).

### A critical operation present in the envelope escalates

Given a decoded envelope that contains a `setOptions` or `changeTrust` operation (alone or alongside other operations), when the mapping layer sets `changes_signers: true` / `changes_trustline: true` and marks the operation critical, then the whole envelope escalates to `REQUIRE_HUMAN_APPROVAL` (ESCALATE).

## Acceptance Criteria

- Every Stellar operation type maps to a defined `actionKind` and `riskClass`; there is no operation type for which the map is silent.
- `payment`, `pathPaymentStrictSend`, and `pathPaymentStrictReceive` map to `actionKind: "transfer"`, `riskClass: SENSITIVE_EXECUTION`.
- `changeTrust` and `setOptions` are marked critical and force `REQUIRE_HUMAN_APPROVAL` (ESCALATE); they set `changes_trustline: true` and `changes_signers: true` respectively.
- `createAccount` maps to a transfer-like `actionKind`; `manageData`, `manageSellOffer`, `manageBuyOffer`, and any other type map to the nearest `actionKind` with conservative (escalate-by-default) handling.
- The new context flags are additive: they extend the existing `flags` object and do not remove, rename, or break any existing field or existing policy evaluation.
- In a multi-operation envelope, if any operation is critical the whole envelope escalates.
- An unmapped or future operation type defaults fail-closed to `BLOCKED_UNKNOWN` and escalation.
- The four decision-only demo cases pass end-to-end using the UNCHANGED policy engine.
- The brain is untouched and Solana stays green.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- `stellar-wave-2-xdr-decoder` — provides the decoded operation list (operation type plus typed fields such as destination and amount) that this wave maps.
- Existing brain: `shared/types/executionGatewayContracts.ts` (`TOOL_RISK_CLASSES`, `COMPASS_DECISIONS`), `shared/types/policyContracts.ts` (`PolicyEvaluationContext`), and the policy engine consumed by `hosted/evaluate/evaluationService.ts`.

## Deferred To Later Waves

- Classic multisig threshold evaluation and co-signer logic.
- Real signing, submission, or simulation of Stellar transactions.
- Moving the operation→`actionKind` table out of code into policy configuration (Wave 3 keeps it in code for the MVP; configurable later).
- Asset-aware USD valuation of non-native Stellar assets beyond what the existing context supports.
- Soroban contract-invocation classification.
