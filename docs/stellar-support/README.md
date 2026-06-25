# Stellar support — wave track overview

This directory indexes the **Stellar support track**: a set of planning specs (`status: planned`) describing what COMPASS needs in order to operate on **Stellar Testnet** alongside the existing Solana implementation, without rewriting the core.

The track is grounded in a readiness analysis of the repo. Two physical layers drive every decision:

- **The brain** — policy engine (`hosted/policy/policyEngine.ts`), LLM judge (`hosted/llm/llmDecisionAdapter.ts`), sanitizer (`hosted/llm/llmDecisionSanitizer.ts`), decision contract `COMPASS_DECISIONS` (`shared/types/executionGatewayContracts.ts`), and MCP proxy (`back/services/mcp/proxy/*`). **Chain-agnostic. Stays untouched across the whole track.**
- **The body** — transaction construction, signing, RPC, on-chain validation (`back/services/solana/*`, `back/services/support/signer/*`, `hosted/onchain/*`, `back/solana/*` Anchor programs). **Deeply Solana-coupled.** Stellar gets a *parallel* body, never a replacement.

## Governing principles

- Solana keeps working unchanged in parallel at every wave.
- The brain is never modified — Stellar feeds it through a neutral `ChainAdapter` seam (introduced in Wave 0).
- Every wave leaves the repo green (`npm run test:back`, `npm run lint`, `npx tsc --noEmit --pretty false`) and is demonstrable on its own.
- These are planning specs. Implementation is tracked per-wave in each `task.json` (all tasks currently `pending`).

## The thesis

Compass is a **policy-gated co-signer** for Stellar agent wallets. The user signs a transaction; Compass evaluates it; Compass adds its signature **only** if policy passes. If Compass does not sign, the account's native multisig threshold is not met and the network rejects the transaction. Stellar gives this guarantee **natively** (account signers + thresholds) — Solana needed a custom Anchor program (`back/solana/agent-action-guard`) to force the same gate. That contrast is the "why Stellar" argument.

## Waves

| Wave | Directory | Purpose | Depends on | Essential? |
| --- | --- | --- | --- | --- |
| 0 | [`stellar-wave-0-chain-adapter-boundary`](../stellar-wave-0-chain-adapter-boundary/) | Introduce neutral `ChainAdapter`/`ChainId` seam; re-express Solana behind it. No Stellar logic. | — | ✅ enabler |
| 1 | [`stellar-wave-1-stellar-connectivity`](../stellar-wave-1-stellar-connectivity/) | Stellar Testnet config, Horizon/Soroban clients, Friendbot. | 0 | ✅ |
| 2 | [`stellar-wave-2-xdr-decoder`](../stellar-wave-2-xdr-decoder/) | Decode `TransactionEnvelope` XDR → neutral `SemanticFacts`. | 0, 1 | ✅ |
| 3 | [`stellar-wave-3-operation-mapping`](../stellar-wave-3-operation-mapping/) | Map Stellar operations → actionKind/riskClass + policy flags. | 2 | ✅ |
| 4 | [`stellar-wave-4-cosigning-multisig`](../stellar-wave-4-cosigning-multisig/) | Policy-gated co-signer; multi-signer model; account threshold inspection. | 0, 1, 2, 3 | ✅ core of thesis |
| 5 | [`stellar-wave-5-audit-trail-multisig`](../stellar-wave-5-audit-trail-multisig/) | Additive audit fields (chain, signers, threshold, txHash). | 0, 4 | ✅ demo evidence |
| 6 | [`stellar-wave-6-demo-and-testnet-setup`](../stellar-wave-6-demo-and-testnet-setup/) | One-command reproducible Testnet demo (6 cases) + runbook. | 1, 2, 3, 4, 5 | ✅ |
| 7 | [`stellar-wave-7-zk-hook`](../stellar-wave-7-zk-hook/) | Optional ZK proof of policy-compliance, gated on hackathon needs. | 3, 4 | ⚠️ only if ZK must be central |

## Critical path

`0 → (1 ∥ 2) → 3 → 4 → 5 → 6`. Waves 1 and 2 can proceed in parallel once Wave 0 lands. Wave 4 carries the most risk (a mis-configured threshold invalidates the demo). Wave 7 is exploratory and must pass its own decision gate before any implementation.

## Demo cases (resolved across the track)

1. Legit payment within policy → **ALLOW** (Compass co-signs, executes) — Waves 2–4
2. Payment to non-allowlisted destination → **DENY** — Waves 2–3
3. Amount out of range → **ESCALATE** — Waves 2–3
4. Critical op (`setOptions` / `changeTrust`) → **ESCALATE** — Wave 3
5. User signs, Compass does not → threshold unmet → **not executable** — Wave 4
6. User + Compass sign → **executable** — Waves 4, 6

## Source

Readiness analysis and wave roadmap were produced from a direct inspection of the repo (see git history on `spec-definition`). Each `task.json` records `analysisSource`, `dependsOn`, and `openQuestions` with resolutions.
