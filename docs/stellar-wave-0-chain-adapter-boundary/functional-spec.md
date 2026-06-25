# Stellar Wave 0 — Chain adapter boundary functional spec

Stellar Wave 0 is the enabler wave for multi-chain Compass. It introduces a neutral `ChainAdapter` abstraction and a `ChainId` type, then re-expresses the existing Solana code behind that adapter without changing any Solana behavior. No Stellar logic is added in this wave — its only job is to create the seam so that later Stellar waves can plug in a chain without re-leaking Solana coupling into the brain.

## Business Problem

Today there is no chain abstraction in Compass. The chain identity is hardcoded in three places: the signing interface is typed directly on Solana's `VersionedTransaction` (`back/services/support/signer/signerAdapterContracts.ts`); the chain is a TypeScript literal `chain: "solana"` in the shared decision contracts (`shared/types/executionGatewayContracts.ts`); and chain/network strings are hardcoded in `hosted/evaluate/evaluationService.ts` and in the transfer/swap gateways. Even the LLM router prompt names "Solana" directly.

Because there is no seam, any attempt to add a second chain (Stellar) would either fork the brain or re-leak chain coupling into the policy engine, the LLM judge, and the gateways. Stellar Wave 0 removes that risk by defining a single neutral boundary that every chain must satisfy, and proving it by routing the current Solana implementation through it with zero behavior change.

## Goals

- Define a neutral `ChainAdapter` interface and a `ChainId = "solana" | "stellar"` type in a shared contracts file.
- Define the chain-neutral `SemanticFacts`, `AccountSignerState`, and `ChainAuditMetadata` types the brain consumes.
- Add a `chainRegistry` that resolves a `ChainAdapter` by `ChainId`.
- Implement `SolanaChainAdapter`, wrapping the existing Solana tx-build / sign / connection modules to satisfy `ChainAdapter`, with no Solana behavior change.
- Replace the hardcoded `chain: "solana"` literal types in the decision contracts with `ChainId`.
- Make `hosted/evaluate/evaluationService.ts` inject chain/network from configuration instead of hardcoding the strings.
- Keep all existing Solana tests green.

## Non-Goals

- No Stellar implementation, no Stellar SDK, no Soroban/Horizon code.
- No change to Solana runtime behavior — Solana must keep working unchanged in parallel.
- No change to the brain: policy engine, LLM judge, decision sanitizer, the `COMPASS_DECISIONS` decision contract semantics, and the MCP proxy stay untouched.
- No change to the LLM router prompt wording beyond what is required for the seam (prompt rewording is deferred).
- No new MCP tools and no signer behavior change.
- No `legacy/` imports.

## User-Visible Scenarios

There are no end-user-visible behavior changes in this wave. The scenarios below describe developer- and system-visible outcomes.

### Solana keeps working unchanged behind the adapter

Given the existing Solana transfer and swap flows, when the code is re-expressed so that those flows call `SolanaChainAdapter` instead of the hardcoded modules directly, then every existing Solana test stays green and the decoded semantic facts, audit metadata, and signing behavior are byte-for-byte equivalent to today.

### A chain is resolved through the registry

Given a `ChainId` of `"solana"`, when a caller asks the `chainRegistry` for an adapter, then it returns the `SolanaChainAdapter`. Given an unregistered `ChainId` such as `"stellar"`, when a caller asks for it, then the registry returns a clear "adapter not registered" error rather than silently defaulting to Solana.

### The decision contract is chain-neutral

Given the shared decision contracts, when the `chain` field type is changed from the `"solana"` literal to `ChainId`, then existing Solana audit events and action candidates still typecheck and still carry `chain: "solana"` at runtime, and the policy engine and judge consume the same fields with no code change.

### Chain/network are injected, not hardcoded

Given the hosted evaluation service, when chain and network are read from server configuration instead of the literal `"solana"` strings, then the default configuration still resolves to Solana and the evaluation output is unchanged.

## Acceptance Criteria

- `ChainAdapter`, `ChainId`, and `SemanticFacts` are exported from a single contracts file (`shared/types/chainContracts.ts`), alongside `AccountSignerState` and `ChainAuditMetadata`.
- `SemanticFacts` carries the chain-neutral fields the policy engine already consumes: `actionKind`, `sourceAddress`, `recipientAddress`, `asset`, `amount`, `amountUsd`, plus optional risk flags.
- Solana is re-expressed behind a `SolanaChainAdapter` with no behavior change; existing Solana tests stay green.
- `chainRegistry` resolves a `ChainAdapter` by `ChainId` and fails clearly for unregistered chains.
- The `chain: "solana"` literal types in `shared/types/executionGatewayContracts.ts` are replaced by `ChainId`.
- `hosted/evaluate/evaluationService.ts` injects chain/network from configuration instead of hardcoding `"solana"`.
- No Stellar logic is added in this wave.
- Brain files are untouched: `hosted/policy/policyEngine.ts`, `hosted/llm/llmDecisionAdapter.ts`, `hosted/llm/llmDecisionSanitizer.ts`, the `COMPASS_DECISIONS` contract semantics in `shared/types/executionGatewayContracts.ts`, and `back/services/mcp/proxy/*`.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance: the full backend suite passes (including all pre-existing Solana tests), lint is clean aside from pre-existing warnings, and the typecheck exits zero with `chain` typed as `ChainId` across the contracts and the evaluation service.

## Dependencies

- None. `dependsOn: []`. This wave is the enabler that later Stellar waves depend on.

## Deferred To Later Waves

- The actual `StellarChainAdapter` implementation (decode, inspectAccount, cosign, submit) — a later Stellar wave.
- Per-chain signer adapters or splitting `cosign`/`submit` out of `ChainAdapter` if a later chain demands it.
- Rewording the LLM router prompt to be chain-neutral or chain-parameterized.
- Stellar-specific policy thresholds, asset metadata, or audit fields.
- Multi-chain selection surfaced through request payloads or MCP tool inputs.
