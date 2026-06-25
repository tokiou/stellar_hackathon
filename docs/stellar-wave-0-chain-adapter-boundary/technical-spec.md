# Stellar Wave 0 — Chain adapter boundary technical spec

Stellar Wave 0 introduces a neutral chain seam between the Compass brain (policy engine, LLM judge, sanitizer, decision contract, MCP proxy) and any concrete chain. It defines `ChainAdapter` / `ChainId` and the chain-neutral fact types, adds a `chainRegistry`, and wraps the current Solana modules in a `SolanaChainAdapter`. No Stellar code is added; Solana behavior is preserved exactly.

## Architecture

```txt
brain (UNTOUCHED)
  policy engine / LLM judge / sanitizer / COMPASS_DECISIONS / MCP proxy
        |
        | consumes neutral types only (ChainId, SemanticFacts, ChainAuditMetadata)
        v
  chainRegistry.resolve(chainId: ChainId): ChainAdapter
        |
        +--> SolanaChainAdapter  (NEW wrapper, no behavior change)
        |        wraps existing Solana tx-build / sign / connection modules
        |        decode() -> SemanticFacts
        |        buildAuditMetadata() -> ChainAuditMetadata
        |
        +--> StellarChainAdapter (NOT in this wave — registry slot only)

evaluationService: chain/network injected from config (was literal "solana")
executionGatewayContracts: chain: ChainId (was chain: "solana")
```

The brain never imports a concrete chain module. It depends only on `shared/types/chainContracts.ts`. The registry is the single place that maps a `ChainId` to a concrete adapter.

## Files

| File | Role |
| --- | --- |
| `shared/types/chainContracts.ts` | NEW. Defines `ChainId`, `SemanticFacts`, `AccountSignerState`, `ChainAuditMetadata`, and the `ChainAdapter` interface. |
| `back/services/chain/chainRegistry.ts` | NEW. Resolves a `ChainAdapter` by `ChainId`; registers Solana only. |
| `back/services/chain/solana/solanaChainAdapter.ts` | NEW. Wraps existing Solana tx-build/sign/connection modules to satisfy `ChainAdapter`. No behavior change. |
| `shared/types/executionGatewayContracts.ts` | EDIT. Replace `chain: "solana"` literal types (ActionCandidate, AuditEvent) with `chain: ChainId`. Decision contract semantics unchanged. |
| `hosted/evaluate/evaluationService.ts` | EDIT. Inject chain/network from config instead of the literal `"solana"` strings (around lines 143, 180-181, 201). |
| `back/services/support/signer/signerAdapterContracts.ts` | REFERENCE. Currently typed on Solana `VersionedTransaction`; the neutral `cosign`/`submit` use opaque `string` payloads (see Behavior). |

## Contracts

The neutral chain seam (`shared/types/chainContracts.ts`):

```ts
export type ChainId = "solana" | "stellar";

export interface SemanticFacts {
  actionKind: string;          // e.g. "transfer" | "swap"
  sourceAddress: string;
  recipientAddress: string;
  asset: string;
  amount: number;
  amountUsd: number;
  // optional risk flags the policy engine may consult
  isUnknownRecipient?: boolean;
  isHighValue?: boolean;
  riskFlags?: string[];
}

export interface AccountSignerState {
  address: string;
  exists: boolean;
  signers?: string[];
  threshold?: number;
}

export interface ChainAuditMetadata {
  chainId: ChainId;
  network: string;
  actionKind: string;
  // chain-specific, non-sensitive fields; never raw keys or raw tx bytes
  [key: string]: unknown;
}

export interface ChainAdapter {
  readonly chainId: ChainId;
  decode(payload: string): Promise<SemanticFacts>;            // opaque payload -> semantic facts the policy engine consumes
  inspectAccount?(address: string): Promise<AccountSignerState>;
  cosign?(payload: string, signerRef: string): Promise<string>;
  submit?(payload: string): Promise<{ txHash: string }>;
  buildAuditMetadata(facts: SemanticFacts, result?: unknown): ChainAuditMetadata;
}
```

The registry (`back/services/chain/chainRegistry.ts`):

```ts
type ResolveResult =
  | { ok: true; adapter: ChainAdapter }
  | { ok: false; reason: "CHAIN_ADAPTER_NOT_REGISTERED" };

export function resolveChainAdapter(chainId: ChainId): ResolveResult;
```

The decision contract edit (`shared/types/executionGatewayContracts.ts`):

```ts
// before: chain: "solana";
// after:
chain: ChainId;   // ActionCandidate and AuditEvent; runtime value stays "solana"
```

## Behavior

- `decode(payload)` takes the chain's opaque transaction payload (for Solana, the serialized `VersionedTransaction`) and returns `SemanticFacts`. The policy engine and judge consume only `SemanticFacts`, never the raw payload — this is what keeps the brain chain-neutral.
- `SolanaChainAdapter` delegates to the existing Solana tx-build / sign / connection modules. It must not re-implement or alter their logic; it only adapts their inputs/outputs to the neutral types. Output `SemanticFacts` must equal what the current Solana path produces today.
- `cosign`/`submit` use opaque `string` payloads in the neutral interface so the brain never references `VersionedTransaction`. The Solana adapter deserializes the string at the edge. These methods are optional on the interface (see openQuestion Q1 resolution).
- `chainRegistry` registers only Solana in this wave. Resolving `"stellar"` returns `CHAIN_ADAPTER_NOT_REGISTERED` — never a silent Solana fallback.
- `evaluationService` reads chain/network from server config; the default config resolves to Solana, so output is unchanged.
- `buildAuditMetadata` returns only non-sensitive fields; it must never include raw transaction bytes, private keys, secret material, or raw prompts.

## Tests

- `chainContracts.ts` exports `ChainAdapter`, `ChainId`, `SemanticFacts`, `AccountSignerState`, `ChainAuditMetadata` (compile/shape test).
- A class implementing `ChainAdapter` with only the required members (`chainId`, `decode`, `buildAuditMetadata`) compiles — optional methods are genuinely optional.
- `resolveChainAdapter("solana")` returns `{ ok: true, adapter }` whose `chainId === "solana"`.
- `resolveChainAdapter("stellar")` returns `{ ok: false, reason: "CHAIN_ADAPTER_NOT_REGISTERED" }`.
- `SolanaChainAdapter.decode` produces `SemanticFacts` equal to the current Solana decode output for a representative transfer and swap payload (parity test).
- `buildAuditMetadata` output contains no raw tx bytes or secret material.
- All pre-existing Solana transfer/swap/gateway tests still pass unchanged.
- Decision contracts with `chain: ChainId` still typecheck and Solana values still carry `chain: "solana"` at runtime.
- No `legacy/` import appears in any new chain file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: full backend suite green (including pre-existing Solana tests), lint clean aside from pre-existing warnings, typecheck exits zero with `chain` typed as `ChainId`.

## Dependencies

- None. `dependsOn: []`.

## Deferred To Later Waves

- `StellarChainAdapter` (decode/inspectAccount/cosign/submit) and its registry registration.
- Deciding whether `cosign`/`submit` should split into a per-chain `SignerAdapter` if multisig/co-signing flows grow (see openQuestion Q1).
- Re-typing `signerAdapterContracts.ts` off `VersionedTransaction` onto opaque payloads, if a later wave needs the signer boundary itself to be chain-neutral.
- Chain selection via request payload or MCP input (see openQuestion Q2).
- LLM router prompt chain-neutralization.
