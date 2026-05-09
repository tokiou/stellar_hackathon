# T9 Spec — Real API provider implementation

## Objective
Replace demo-only API provider stubs with real HTTP integrations where the API is public/configured, while preserving deterministic fallback behavior when keys are missing.

## Requirements
- JupiterQuoteRiskProvider must call Jupiter Quote API using token mints/amount/slippage and map `priceImpactPct`, `routePlan`, `outAmount`, `otherAmountThreshold` into deterministic risk signals.
- BirdeyeTokenSecurityProvider must call Birdeye when `VITE_BIRDEYE_API_KEY` exists; missing/unavailable key falls back to MockTokenSecurityProvider.
- ExternalRiskScoreProvider must call configured `VITE_RISK_SCORE_API_URL` when present; missing/unavailable provider falls back to MockRiskScoreProvider or non-blocking unavailable signal.
- HeliusReceiptProvider must call Helius enhanced transactions endpoint when `VITE_HELIUS_API_KEY` exists; otherwise return basic receipt.
- Tests must mock `fetch` and must not depend on live network/API keys.
- Do not read `.env` or print secrets.
