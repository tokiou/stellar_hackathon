# Technical Spec — Provider-Based Risk Engine

## Architecture
The risk engine is a provider orchestrator. Providers return deterministic `RiskReason` signals. The core engine aggregates them using fixed rules and returns a `RiskAssessment` consumed by the UI and signing flow.

```txt
ParsedIntent + optional quote + optional prepared Transaction
  -> provider list
      -> LocalAllowlistProvider
      -> JupiterQuoteRiskProvider
      -> BirdeyeTokenSecurityProvider or MockTokenSecurityProvider
      -> ExternalRiskScoreProvider or MockRiskScoreProvider
      -> RecipientValidationProvider
      -> TransactionSimulationProvider
  -> aggregateRiskLevel(signals)
  -> RiskAssessment
```

Post-confirmation:

```txt
signature -> HeliusReceiptProvider -> TransactionReceipt -> HistoryEntry.receipt
```

## Files
Expected new/modified files:
- `src/lib/types.ts`
- `src/lib/riskEngine.ts`
- `src/lib/risk/providers/LocalAllowlistProvider.ts`
- `src/lib/risk/providers/JupiterQuoteRiskProvider.ts`
- `src/lib/risk/providers/BirdeyeTokenSecurityProvider.ts`
- `src/lib/risk/providers/ExternalRiskScoreProvider.ts`
- `src/lib/risk/providers/RecipientValidationProvider.ts`
- `src/lib/risk/providers/TransactionSimulationProvider.ts`
- `src/lib/risk/providers/HeliusReceiptProvider.ts`
- `src/lib/risk/providers/MockTokenSecurityProvider.ts`
- `src/lib/risk/providers/MockRiskScoreProvider.ts`
- `src/components/SafetyReviewPanel.tsx`
- `src/pages/Index.tsx`
- `.env.example`
- tests under `src/lib/risk/**/__tests__`

## Type Contracts
`RiskReason` must remain backward-compatible with current UI fields `label`, `detail`, and `severity`, while adding explicit signal provenance:

```ts
export interface RiskReason {
  label: string;
  detail: string;
  severity: RiskLevel;
  checkName: string;
  source: string;
  value: string | number | boolean | null;
  threshold: string;
  riskImpact: RiskLevel;
  explanation: string;
  isMock?: boolean;
  metadata?: Record<string, unknown>;
}
```

`RiskAssessment` must include:
- final `level`
- `reasons`
- `signals` alias/detail array
- `recommendation`
- `requiresConfirmation`
- optional `confirmationPhrase`
- `providerResults`

## Provider Interface

```ts
export interface RiskProvider {
  readonly name: string;
  readonly source: string;
  assess(input: RiskProviderInput): Promise<RiskProviderResult>;
}
```

Providers must not throw to the UI. Errors are represented as `RiskProviderResult.status = 'failed'` or by fallback providers.

## Environment Variables
Optional names only:
- `VITE_BIRDEYE_API_KEY`
- `VITE_BIRDEYE_API_URL`
- `VITE_RISK_SCORE_API_KEY`
- `VITE_RISK_SCORE_API_URL`
- `VITE_JUPITER_API_URL`
- `VITE_HELIUS_API_KEY`
- `VITE_HELIUS_API_URL`

Never read or print values. Missing variables are normal and must use mocks/fallbacks.

## Simulation Gate
Current wallet adapter `sendTransaction(tx, connection)` requests signature and sends in one step. Therefore transfer flow must be:
1. Build unsigned transaction.
2. Run `TransactionSimulationProvider` using `connection.simulateTransaction` with signature verification disabled where supported.
3. Update `riskAssessment` in UI.
4. If final risk is `BLOCKED`, stop before `sendTransaction`.
5. Otherwise call `sendTransaction`.

## Helius Receipt
`HeliusReceiptProvider.fetchReceipt(signature)` should:
- use enhanced Helius response when key/url are configured;
- return basic receipt with Solana Explorer URL if not configured;
- never block transaction completion UX if unavailable.

## Testing Strategy
Use unit tests for:
- aggregation rules, especially “two MEDIUM => HIGH”;
- allowlist blocking;
- recipient validation;
- quote/slippage rules;
- mock provider labeling;
- simulation failure blocking.

## Security Constraints
- No LLM/AI risk computation in source.
- No private keys, seed phrases, or secret values.
- Default to Devnet behavior already present.
- Block failed simulations before wallet signature.
- Treat external API/on-chain responses as untrusted and validate fields before use.
