# T4 Spec — Simulation and receipts

## Objective
Simulate prepared transactions before signing and fetch post-transaction receipts.

## Providers
- TransactionSimulationProvider
- HeliusReceiptProvider

## Rules
Simulation failure is BLOCKED. Unexpected balance changes are HIGH when detectable. Success with expected changes continues. If no transaction is prepared, show Not simulated yet as LOW. Helius unavailable returns a basic receipt with signature/explorer link.
