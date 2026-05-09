# T2 Spec — Local providers and mocks

## Objective
Implement deterministic no-secret/no-network providers.

## Providers
- LocalAllowlistProvider
- RecipientValidationProvider
- MockTokenSecurityProvider
- MockRiskScoreProvider

## Rules
Unknown token symbol, unknown mint, or mint mismatch is BLOCKED. Invalid recipient, unresolved .sol, and unknown contact names are BLOCKED. New valid address is MEDIUM; saved contact is LOW. Mock providers must clearly label demo data.
