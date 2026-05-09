# Functional Spec — Provider-Based Deterministic Risk Engine

## Execution Decision
- Strategy: SDD_SUBAGENTS.
- Rule fired: R5 + SDD checklist 1,2,3,4,5.
- Reason: the change introduces a new provider architecture, observable UI flow, transaction-simulation safety gate, external API fallbacks, and acceptance criteria for multiple verifiers.

## Product Goal
Upgrade the current MVP risk engine into a modular, deterministic, provider-based system that combines multiple transparent risk signals before a user signs a Solana transaction.

The LLM must not calculate, override, or change risk. The LLM may only explain already-computed rule-based results in simpler language.

## Required Risk Levels
- `LOW`
- `MEDIUM`
- `HIGH`
- `BLOCKED`

## Required Data Contracts
The implementation must expose these TypeScript contracts:
- `RiskAssessment`
- `RiskLevel`
- `RiskReason`
- `TokenSecurityData`
- `LiquidityData`
- `QuoteRiskData`
- `RecipientRiskData`
- `SimulationRiskData`

Each risk signal/reason must include:
- check/source name
- source/tool used
- result value
- threshold
- risk impact
- human-readable explanation

## Providers
The system must include these provider classes/modules:
- `LocalAllowlistProvider`
- `JupiterQuoteRiskProvider`
- `BirdeyeTokenSecurityProvider`
- `ExternalRiskScoreProvider`
- `RecipientValidationProvider`
- `TransactionSimulationProvider`
- `HeliusReceiptProvider`
- `MockTokenSecurityProvider`
- `MockRiskScoreProvider`

The app must work without paid API keys. Missing keys must produce mock/demo or unavailable-labeled signals, never crashes. API key names may be documented, but secret values must never be read or exposed.

## Functional Rules

### 1. Token Allowlist
Source: local allowlist in code.
MVP allowlist: `SOL`, `USDC`, `BONK`, `JUP`, `PYTH`.

Rules:
- Unknown token symbol: `BLOCKED`.
- Token symbol with unknown mint address: `BLOCKED`.
- Token mint mismatch: `BLOCKED`.

User reason: “Token is not supported by this MVP, so the transaction is blocked.”

### 2. Token Security
Preferred source: Birdeye Token Security API.
Fallback: `MockTokenSecurityProvider`.

Fields when available:
- creation/mint time
- liquidity
- holder count
- holder concentration
- ownership/security flags
- mutable metadata
- mint/freeze authority
- verification/status

Rules:
- Token age < 1 hour: `HIGH`.
- Token age < 24 hours: `MEDIUM`.
- Liquidity < $5,000: `HIGH`.
- Liquidity < $50,000: `MEDIUM`.
- Holder count < 100: `MEDIUM`.
- Top holder concentration > 70%: `HIGH`.
- Top holder concentration > 30%: `MEDIUM`.
- Token is not verified: `MEDIUM`.
- Mint/freeze authority enabled when suspicious: `MEDIUM` or `HIGH`.

### 3. Risk Score Provider
Preferred source: Solana Tracker Risk Score API or RugCheck API.
Fallback: `MockRiskScoreProvider`.

Rules:
- Critical risk: `HIGH`.
- Severe/rug risk: `HIGH`.
- Poor score per provider scale: `HIGH`.
- Medium score: `MEDIUM`.
- Provider unavailable: do not block; show “external risk provider unavailable”.

### 4. Price Impact and Route Quality
Preferred source: Jupiter Quote API.

Rules:
- `priceImpactPct > 10%`: `HIGH`.
- `priceImpactPct > 3%`: `MEDIUM`.
- No route found: `BLOCKED`.
- Output amount zero/invalid: `BLOCKED`.
- Unsupported/unknown venue if detectable: `MEDIUM`.

### 5. Slippage
Source: local rule with user-selected slippage and quote fields.

Rules:
- Slippage > 5%: `HIGH`.
- Slippage > 2%: `MEDIUM`.
- Slippage <= 1%: `LOW` unless other risks exist.

### 6. Recipient Validation
Sources: `@solana/web3.js` `PublicKey`, local contacts, future SNS.

Rules:
- Invalid Solana public key: `BLOCKED`.
- Contact name not found: `BLOCKED`.
- `.sol` name cannot be resolved deterministically: `BLOCKED`.
- New address not in contacts: `MEDIUM`.
- Known saved contact: `LOW`.

### 7. Transaction Simulation
Source: Solana RPC `simulateTransaction`.

Rules:
- Simulate prepared transaction before asking user to sign.
- Simulation failure: `BLOCKED`.
- Simulation success with unexpected balance changes: `HIGH`.
- Simulation success with expected changes: continue.
- Not prepared yet: show `Not simulated yet` as a visible `LOW`/informational signal.

### 8. Post-Transaction Receipt
Source: Helius Enhanced Transactions API after signature.

Fields:
- transaction type
- token transfers
- native transfers
- fee
- signature
- status
- timestamp

If Helius is unavailable, store a basic receipt with signature and Solana Explorer URL.

## Aggregation Rules
Final risk is deterministic:
1. If any signal is `BLOCKED`, final risk = `BLOCKED`.
2. Else if any signal is `HIGH`, final risk = `HIGH`.
3. Else if two or more signals are `MEDIUM`, final risk = `HIGH`.
4. Else if one signal is `MEDIUM`, final risk = `MEDIUM`.
5. Else final risk = `LOW`.

## UI Requirements
Inside `SafetyReviewPanel`, add “How we checked this”. For each signal show:
- Check name
- Source/tool used
- Result
- Risk impact
- Threshold
- Explanation

Mock/demo/unavailable data must be clearly labeled.

## Acceptance Criteria
- All required types and providers exist.
- App works without paid API keys.
- Risk decisions are deterministic and rule-based.
- Safety Review exposes every check.
- Transfers simulate before wallet signature.
- Failed simulations block signing.
- Helius receipt is attempted after confirmed transactions.
- Specs exist for every task under `docs/task-specs/`.
