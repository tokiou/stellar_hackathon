# Stellar Wave 3 — Operation mapping and policy context technical spec

Stellar Wave 3 introduces a mapping layer between the Wave 2 XDR decoder and the existing Compass policy engine. It adds two pure modules: a static table mapping each Stellar operation type to an `actionKind` and a `riskClass`, and a derivation function that builds the `PolicyEvaluationContext` the engine already consumes — extended additively with two Stellar-relevant flags. No brain code changes. Solana is untouched.

## Architecture

```txt
Wave 2 XDR decoder
  -> DecodedStellarEnvelope { operations: DecodedStellarOperation[] }
    -> Wave 3 mapping layer (this wave)
       stellarOperationMap.ts
         mapStellarOperation(opType) -> { actionKind, riskClass, critical, contextFlags }
       stellarPolicyContext.ts
         deriveStellarPolicyContext(envelope)
           -> aggregate operations
           -> any critical => envelope critical (escalate)
           -> PolicyEvaluationContext { amount_usd, recipient_address,
                                        recipient_known, flags{...additive} }
    -> EXISTING policy engine (unchanged)
       evaluateAction({ candidate, classification, context, policy })
         -> COMPASS_DECISIONS { ALLOW | DENY | REQUIRE_HUMAN_APPROVAL | ... }
```

The mapping layer is pure and side-effect free. It produces the same shapes the engine already accepts; the engine does the deciding.

## Files

| File | Role |
| --- | --- |
| `back/services/stellar/operations/stellarOperationMap.ts` | Static table mapping each Stellar operation type to `actionKind` + `riskClass`, a `critical` flag, and the policy-context flags it should set. Exposes `mapStellarOperation` with a fail-closed default. |
| `back/services/stellar/operations/stellarPolicyContext.ts` | `deriveStellarPolicyContext(envelope)` — aggregates decoded operations into the existing `PolicyEvaluationContext` plus additive Stellar flags; escalates if any operation is critical. |
| `back/services/stellar/operations/__tests__/stellarOperationMap.test.ts` | Tests for the map: every known type covered, criticals, fail-closed default. |
| `back/services/stellar/operations/__tests__/stellarPolicyContext.test.ts` | Tests for context derivation, additive flags, and multi-operation escalation. |

## Contracts

The map entry and derivation reuse the existing `ToolRiskClass` / `CompassDecision` vocabulary; only the two flags are new (added additively to `PolicyEvaluationContext.flags`).

```ts
import type { ToolRiskClass } from "@shared/executionGatewayContracts";
import type { PolicyEvaluationContext } from "@shared/policyContracts";

export type StellarOperationType =
  | "payment"
  | "pathPaymentStrictSend"
  | "pathPaymentStrictReceive"
  | "createAccount"
  | "changeTrust"
  | "setOptions"
  | "manageData"
  | "manageSellOffer"
  | "manageBuyOffer";

export type StellarOperationMapping = {
  actionKind: string;        // engine vocabulary, e.g. "transfer"
  riskClass: ToolRiskClass;  // from TOOL_RISK_CLASSES
  critical: boolean;         // true => envelope must escalate (ESCALATE)
  contextFlags?: {           // additive flags merged into PolicyEvaluationContext.flags
    changes_trustline?: boolean;
    changes_signers?: boolean;
  };
};

// Fail-closed: unknown/future op types resolve to BLOCKED_UNKNOWN + critical.
export function mapStellarOperation(opType: string): StellarOperationMapping;

// Aggregates decoded operations into the context the existing engine consumes.
// Additive only: never removes or renames existing PolicyEvaluationContext fields.
export function deriveStellarPolicyContext(
  envelope: { operations: DecodedStellarOperation[] },
): PolicyEvaluationContext;
```

`DecodedStellarOperation` is provided by Wave 2 (operation type plus typed fields such as `destination` and `amount`). Wave 3 only reads it.

## Behavior

The static map (in code for the MVP):

| Operation type | actionKind | riskClass | critical | flags set |
| --- | --- | --- | --- | --- |
| `payment` | `transfer` | `SENSITIVE_EXECUTION` | no | — |
| `pathPaymentStrictSend` | `transfer` | `SENSITIVE_EXECUTION` | no | — |
| `pathPaymentStrictReceive` | `transfer` | `SENSITIVE_EXECUTION` | no | — |
| `createAccount` | `transfer` | `SENSITIVE_EXECUTION` | no | — |
| `changeTrust` | `transfer` | `SENSITIVE_EXECUTION` | **yes** | `changes_trustline: true` |
| `setOptions` | `transfer` | `SENSITIVE_EXECUTION` | **yes** | `changes_signers: true` |
| `manageData` | `transfer` | `SENSITIVE_EXECUTION` | **yes** (conservative) | — |
| `manageSellOffer` | `transfer` | `SENSITIVE_EXECUTION` | **yes** (conservative) | — |
| `manageBuyOffer` | `transfer` | `SENSITIVE_EXECUTION` | **yes** (conservative) | — |
| _unmapped / future_ | `unknown` | `BLOCKED_UNKNOWN` | **yes** | — |

Rules:

- Value-movement operations (`payment`, both path-payment variants, `createAccount`) are non-critical: the existing engine decides ALLOW / DENY / ESCALATE from `amount_usd`, `recipient_address`, and `recipient_known`.
- `changeTrust` and `setOptions` are critical: they always escalate because they alter trustlines and signer/threshold configuration. The brain still produces the decision; criticality is surfaced via `riskClass`, the critical aggregation, and the additive flags.
- `deriveStellarPolicyContext` reads the operation fields Wave 2 decoded: `recipient_address` from a `payment`/`createAccount` destination, `amount_usd` from the value field (where determinable), and `recipient_known` from the allowlist signal already used by the engine.
- Additive flags: the function spreads existing `flags` and ORs in `changes_trustline` / `changes_signers`. Existing flags (`unknown_program`, `unlimited_delegate`, `authority_change`, `suspicious_recipient`) are preserved untouched.
- Multi-operation envelope: the context represents the whole envelope. If any operation is critical, the derived context carries the critical flags so the existing engine escalates the envelope as a unit.
- Fail-closed default: `mapStellarOperation` returns `BLOCKED_UNKNOWN` + `critical: true` for any type not in the table, so unknown/future operations escalate rather than slip through.

## Tests

- `mapStellarOperation` returns the expected `actionKind` + `riskClass` for every known operation type.
- `changeTrust` maps to `critical: true` with `changes_trustline: true`.
- `setOptions` maps to `critical: true` with `changes_signers: true`.
- An unmapped/unknown operation type returns `BLOCKED_UNKNOWN` + `critical: true` (fail-closed).
- `deriveStellarPolicyContext` for a single `payment` produces `amount_usd`, `recipient_address`, `recipient_known` consistent with the decoded operation.
- Additive flags: a `changeTrust` / `setOptions` operation sets only its flag and preserves any pre-existing flags.
- Multi-operation escalation: an envelope with one critical operation plus benign ones yields a context that drives escalation.
- End-to-end decision-only: the four demo cases (ALLOW, DENY, ESCALATE on amount, ESCALATE on critical op) resolve correctly against the UNCHANGED policy engine.
- No `legacy/` import appears in any new Wave 3 file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- `stellar-wave-2-xdr-decoder` — supplies `DecodedStellarEnvelope` / `DecodedStellarOperation`.
- `shared/types/executionGatewayContracts.ts` — `TOOL_RISK_CLASSES`, `COMPASS_DECISIONS`, `CompassDecision`, `ToolRiskClass`.
- `shared/types/policyContracts.ts` — `PolicyEvaluationContext` (flags extended additively).
- Existing policy engine consumed by `hosted/evaluate/evaluationService.ts` (unchanged).

## Deferred

- Moving the operation→`actionKind` table from code into policy configuration (kept in code for MVP).
- Classic multisig threshold and co-signer evaluation.
- Real signing/submission/simulation of Stellar transactions.
- Asset-aware USD valuation for non-native Stellar assets.
- Soroban contract-invocation classification.
