# T1 Spec — Risk contracts and TDD fixtures

## Objective
Define deterministic risk contracts used by all providers and UI.

## Required contracts
- RiskAssessment
- RiskLevel = LOW | MEDIUM | HIGH | BLOCKED
- RiskReason with source, value, threshold, riskImpact, explanation
- TokenSecurityData
- LiquidityData
- QuoteRiskData
- RecipientRiskData
- SimulationRiskData

## Acceptance
Types compile, preserve existing UI compatibility, and are covered by tests for aggregation/provider outputs.
