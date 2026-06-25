# Stellar Wave 5 — Audit trail for multisig technical spec

Stellar Wave 5 extends the persisted audit record so the multisig story is provable from the record alone. It adds OPTIONAL, additive fields to the hosted-side `AuditEntry` (chain, network, accounts, asset/amount, required/collected signers, threshold, txHash, networkError, lifecycle) and a mapper that builds the extended metadata from Wave 0's `ChainAuditMetadata` plus Wave 4's co-signing result. Every field is optional, so existing Solana entries validate unchanged and the brain stays untouched.

## Architecture

```txt
brain (UNTOUCHED)
  policy engine / LLM judge / sanitizer / COMPASS_DECISIONS / MCP proxy
        |
        | Wave 0 ChainAuditMetadata          Wave 4 co-signing result
        | (chainId, network, actionKind,      (requiredSigners, collectedSigners,
        |  sourceAddress, recipient, asset,    threshold, cosigned, txHash?, error?)
        |  amount)                              |
        v                                       v
  back/services/stellar/audit/stellarAuditMetadata.ts   (NEW mapper)
        |  buildStellarAuditMetadata(...) -> AuditEntry extension fields
        v
  AuditEntry (shared/types/evaluationContracts.ts)   <-- NEW optional fields ADDED
        |  written via hosted/audit/auditStore.ts
        |  validated via hosted/audit/auditValidators.ts (accepts old AND new shapes)
        v
  persisted audit record  (Solana entries unchanged; Stellar entries enriched)
```

The mapper is the only new producer of the extended fields. The store and validators stay shape-tolerant: a record with none of the new fields is still valid. Solana producers are not modified.

## Files

| File | Role |
| --- | --- |
| `shared/types/evaluationContracts.ts` | EDIT. Add OPTIONAL fields to `AuditEntry` (chain, network, sourceAccount, destination, asset, amount, requiredSigners, collectedSigners, threshold, txHash, networkError, lifecycle). Add the `AUDIT_LIFECYCLE_STATES` const + type. |
| `shared/types/auditContracts.ts` | REFERENCE. `AuditWriteRequest.entry` is `AuditEntry`, so it picks up the new optional fields with no edit. |
| `hosted/audit/auditValidators.ts` | EDIT. `isAuditEntry` keeps requiring only the original fields; add optional-field type checks that pass when fields are absent and validate them when present. |
| `hosted/audit/auditStore.ts` | REFERENCE. Persists whatever `AuditEntry` it is given; no change needed for additive fields. |
| `back/services/stellar/audit/stellarAuditMetadata.ts` | NEW. Mapper building the extended audit fields from `ChainAuditMetadata` (Wave 0) + the Wave 4 co-signing result. |
| `back/services/domains/transfer/transferGatewayContracts.ts` | REFERENCE. Existing `TRANSFER_AUDIT_LIFECYCLES` is the precedent for the new lifecycle state set. |
| `back/services/domains/transfer/transferAuditLog.ts` | REFERENCE. Precedent for the in-memory audit-event recorder shape. |
| `back/services/mcp/proxy/mcpAuditSink.ts` | REFERENCE. MCP audit sink; unchanged, consumes the enriched entry without modification. |

## Contracts

The lifecycle state set (`shared/types/evaluationContracts.ts`):

```ts
export const AUDIT_LIFECYCLE_STATES = {
  PROPOSED: "PROPOSED",
  COSIGNED_BY_COMPASS: "COSIGNED_BY_COMPASS",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  DENIED: "DENIED",
} as const;

export type AuditLifecycleState =
  (typeof AUDIT_LIFECYCLE_STATES)[keyof typeof AUDIT_LIFECYCLE_STATES];
```

The additive `AuditEntry` extension (every field OPTIONAL — existing Solana entries omit all of them):

```ts
export type AuditEntry = {
  // --- existing required fields (UNCHANGED) ---
  correlationId: string;
  auditRef: string;
  toolName: string;
  decision: HostedDecision;
  riskLevel: HostedRiskLevel;
  reasons: string[];
  outcome?: AuditEntryOutcome;
  occurredAt: string;
  // --- NEW optional fields (additive, backward-compatible) ---
  chain?: ChainId;            // Wave 0 ChainId; absent for legacy entries
  network?: string;
  sourceAccount?: string;
  destination?: string;
  asset?: string;
  amount?: number;
  requiredSigners?: number;
  collectedSigners?: number;
  threshold?: number;
  txHash?: string;            // present only on execution
  networkError?: string;      // present only on submission failure
  lifecycle?: AuditLifecycleState;
};
```

The mapper (`back/services/stellar/audit/stellarAuditMetadata.ts`):

```ts
type CoSigningResult = {
  cosigned: boolean;
  requiredSigners: number;
  collectedSigners: number;
  threshold: number;
  txHash?: string;
  networkError?: string;
};

type StellarAuditFields = Pick<AuditEntry,
  | "chain" | "network" | "sourceAccount" | "destination" | "asset" | "amount"
  | "requiredSigners" | "collectedSigners" | "threshold"
  | "txHash" | "networkError" | "lifecycle">;

export function buildStellarAuditMetadata(
  meta: ChainAuditMetadata,        // Wave 0
  cosign: CoSigningResult,         // Wave 4
): StellarAuditFields;
```

## Behavior

- The mapper reads chain-neutral facts from `ChainAuditMetadata` (`chainId`, `network`, `actionKind`, and the non-sensitive source/recipient/asset/amount fields) and signer facts from the Wave 4 co-signing result. It never reads raw XDR, raw tx bytes, or secret material.
- Lifecycle is derived, not free-form: `DENIED` when the decision denies; `REJECTED` when submission fails (`networkError` set, `txHash` absent); `COSIGNED_BY_COMPASS` when Compass signed but submission has not completed; `SUBMITTED` then `CONFIRMED` as the network result arrives; `PROPOSED` is the initial state.
- `txHash` is set only when execution produced one; `networkError` is set only on failure. The two are mutually exclusive on a terminal entry.
- Non-executability is provable: when Compass does not co-sign, the mapper records `collectedSigners < requiredSigners` together with `threshold`, so the record alone shows the threshold was never met.
- Solana producers are unchanged. They emit entries with none of the new fields, which validate exactly as before — the new fields default to `undefined`.
- The validator (`isAuditEntry`) keeps its existing required-field checks unchanged. New checks are guarded: a field passes if it is `undefined`, and is type-checked only when present (e.g. `chain` must be a valid `ChainId`, counts must be non-negative integers, `lifecycle` must be a member of `AUDIT_LIFECYCLE_STATES`).
- Only semantic facts plus an optional hash are persisted. Full XDR persistence is out of scope (see Deferred); the audit record must never carry raw transaction bytes or keys.

## Tests

- `AuditEntry` with only the original fields validates (`isAuditEntry` returns true) — backward-compatibility test.
- An entry with the full set of new optional fields validates.
- An entry with an invalid present field (e.g. `lifecycle: "BOGUS"`, negative `threshold`, non-`ChainId` `chain`) fails validation.
- `buildStellarAuditMetadata` for a non-co-signed DENY produces `collectedSigners < requiredSigners`, sets `threshold`, and lifecycle `DENIED`.
- `buildStellarAuditMetadata` for a co-signed, confirmed execution produces `collectedSigners == requiredSigners`, a non-empty `txHash`, and lifecycle `CONFIRMED`.
- `buildStellarAuditMetadata` for a submission failure sets `networkError`, leaves `txHash` absent, and sets lifecycle `REJECTED`.
- The mapper output contains no raw XDR, raw tx bytes, or secret material.
- A pre-Wave-5 Solana entry round-trips through `auditStore` write/list unchanged.
- All pre-existing Solana audit tests still pass.
- No `legacy/` import appears in any new audit file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: full backend suite green (including pre-existing Solana audit tests), lint clean aside from pre-existing warnings, typecheck exits zero with the new optional `AuditEntry` fields.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` — `ChainId` and `ChainAuditMetadata`.
- `stellar-wave-4-cosigning-multisig` — the co-signing result (required/collected signers, threshold, txHash, error).

## Deferred

- Optional full-XDR persistence behind an explicit flag (Wave 5 stores semantic facts + optional hash only).
- Unifying the lean `AuditEntry` and the rich `AuditEvent` into one contract.
- A query/filter API over the new chain / lifecycle / signer fields.
- Surfacing the extended audit fields in a frontend or dashboard.
- Retention, redaction, and export policy for the enriched record.
