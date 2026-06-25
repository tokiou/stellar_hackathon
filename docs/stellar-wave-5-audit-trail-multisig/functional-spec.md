# Stellar Wave 5 — Audit trail for multisig functional spec

Stellar Wave 5 extends the Compass audit trail so the multisig story is provable from the persisted record alone. Today the audit entry says *what was decided*; it cannot show *why an action was or was not executable on chain*. This wave adds optional, additive signer and on-chain fields (chain, network, accounts, asset/amount, required/collected signers, threshold, txHash, network errors, and a lifecycle state) so a reviewer can read a single audit record and see "Compass did not co-sign, so collected signers stayed below threshold, so the transaction was not executable." The change is backward-compatible: existing Solana audit entries keep validating unchanged, and the brain stays untouched.

## Business Problem

The persisted hosted-side `AuditEntry` (`shared/types/evaluationContracts.ts`, ~lines 72-81) is minimal: `correlationId`, `auditRef`, `toolName`, `decision`, `riskLevel`, `reasons`, `outcome`, `occurredAt`. It records no chain, no network, no source/destination, no asset or amount, no transaction hash, and — critically — no multisig fields. The richer back-side `AuditEvent` (`shared/types/executionGatewayContracts.ts`) carries `chain`/`network`/`transactionSignature`, but `chain` is still effectively single-chain and it has no signer/threshold fields either.

For the Stellar multisig demo this is an evidence gap. The whole point of co-signing is that Compass is one required signer of N, and that withholding its signature makes a transaction non-executable. But nothing in the audit record proves that: there is no `requiredSigners`, no `collectedSigners`, no `threshold`. A reviewer cannot distinguish "Compass approved but did not sign" from "Compass denied," and cannot see that the transaction never reached the threshold. Wave 5 closes that gap by recording the signer facts alongside the decision.

## Goals

- Add OPTIONAL, additive fields to the persisted `AuditEntry` so existing Solana entries remain valid without change.
- Record `chain` (Wave 0's `ChainId`) and `network` for Stellar audit entries.
- Record the multisig facts: `requiredSigners`, `collectedSigners`, and `threshold`.
- Record `sourceAccount`, `destination`, `asset`, and `amount` as semantic facts (not raw XDR).
- Record `txHash` on successful execution and `networkError` on submission failure.
- Add a lifecycle state: `PROPOSED -> COSIGNED_BY_COMPASS -> SUBMITTED -> CONFIRMED`, with terminal `REJECTED` / `DENIED`.
- Add a mapper that builds the extended metadata from Wave 0's `ChainAuditMetadata` plus Wave 4's co-signing result.
- Keep the audit validators (`hosted/audit/auditValidators.ts`) accepting both the old and the new shapes.
- Keep all existing Solana audit behavior and tests green.

## Non-Goals

- No change to Solana runtime behavior — Solana audit entries keep validating and persisting unchanged.
- No change to the brain: policy engine, LLM judge, decision sanitizer, `COMPASS_DECISIONS`, and the MCP proxy stay untouched.
- No persistence of raw XDR, raw transaction bytes, private keys, or secret material in the audit record (semantic facts + an optional hash only).
- No new audit storage backend, retention policy, or query API change beyond the additive fields.
- No making any new field required; existing producers that omit the new fields must keep working.
- No `legacy/` imports.

## User-Visible Scenarios

The audience here is a demo reviewer or auditor reading the persisted audit record.

### Compass did not co-sign — non-executability is visible

Given a Stellar transfer that Compass evaluates to `DENY` (or escalates), when Compass declines to co-sign, then the audit entry records `requiredSigners`, `collectedSigners` strictly less than `requiredSigners`, the `threshold`, and a lifecycle of `REJECTED`/`DENIED` — making it visible from the record alone that the transaction never reached threshold and was not executable.

### Compass co-signed and the action executed

Given a Stellar transfer that Compass evaluates to `ALLOW`, when Compass co-signs and the transaction is submitted and confirmed, then the audit entry records `collectedSigners == requiredSigners`, a non-empty `txHash`, and a lifecycle progressing `PROPOSED -> COSIGNED_BY_COMPASS -> SUBMITTED -> CONFIRMED`.

### Existing Solana audit entry still validates

Given a Solana audit entry produced before Wave 5 (only the original fields, none of the new ones), when it is written or queried, then the audit validators accept it unchanged and it persists and lists exactly as before.

### Network submission error is recorded

Given a Stellar transaction that Compass co-signed and submitted, when the network rejects or the submission fails, then the audit entry records `networkError` with a non-sensitive reason and a lifecycle of `REJECTED`, while `txHash` remains absent.

## Acceptance Criteria

- All new fields on `AuditEntry` are OPTIONAL and additive; an entry with none of them still validates.
- Pre-Wave-5 Solana audit entries validate, persist, and list unchanged.
- `chain` and `network` are recorded for Stellar audit entries.
- `requiredSigners`, `collectedSigners`, and `threshold` are recorded for multisig actions.
- `sourceAccount`, `destination`, `asset`, and `amount` are recorded as semantic facts (no raw XDR).
- `txHash` is recorded on successful execution; `networkError` is recorded on submission failure.
- A lifecycle state is recorded from the set `PROPOSED | COSIGNED_BY_COMPASS | SUBMITTED | CONFIRMED | REJECTED | DENIED`.
- A mapper builds the extended metadata from Wave 0's `ChainAuditMetadata` plus Wave 4's co-signing result.
- `hosted/audit/auditValidators.ts` accepts both the old and the new entry shapes.
- The brain is untouched and existing Solana tests stay green.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: full backend suite green (including all pre-existing Solana audit tests), lint clean aside from pre-existing warnings, typecheck exits zero with the new optional fields on `AuditEntry`.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — provides `ChainId` and `ChainAuditMetadata`, the neutral types the new audit fields and the mapper build on.
- `stellar-wave-4-cosigning-multisig` — provides the co-signing result (required/collected signers, threshold) the mapper reads.

## Deferred To Later Waves

- A query/filter API to list audit entries by chain, lifecycle, or signer state.
- Optional full-XDR persistence behind an explicit flag (Wave 5 stores semantic facts plus an optional hash only).
- Unifying the lean persisted `AuditEntry` and the rich `AuditEvent` into a single contract.
- Surfacing the multisig audit fields in any frontend or dashboard view.
- Retention, redaction, and export policy for the extended audit record.
