# T3 Spec — External/API-capable providers

## Objective
Implement Jupiter, Birdeye, and external risk score providers with safe fallbacks.

## Security
Never read or expose API secrets. Use VITE_* variable names only and degrade to mock/unavailable signals when absent.

## Rules
Jupiter: no route or invalid output BLOCKED; priceImpactPct >10 HIGH, >3 MEDIUM; slippage >5 HIGH, >2 MEDIUM. Birdeye: age, liquidity, holders, concentration, verification, mint/freeze authority thresholds per user brief. External score: critical/severe/rug/poor HIGH, medium MEDIUM, unavailable informational/non-blocking.
