# API Provider Fallback Strategy

## Overview

The risk engine providers implement a defensive fallback strategy to ensure the application works even when external APIs are unavailable or not configured. This document explains when real API data is used versus demo/mock data.

## Providers and Fallback Behavior

### 1. JupiterQuoteRiskProvider

**Real API Usage:**
- When assessing swap intents, attempts to call the Jupiter Quote API
- Default endpoint: `https://quote-api.jup.ag/v6/quote`
- Configurable via: `VITE_JUPITER_API_URL`
- Uses TOKEN_REGISTRY for mints and decimals
- Converts amounts to raw units (multiplied by 10^decimals)
- Parses: `priceImpactPct`, `routePlan`, `outAmount`, `otherAmountThreshold`

**Fallback to Demo Data:**
- When API fetch fails (network error, timeout, 4xx/5xx response)
- Uses the demo quote from `input.quote` if provided
- Ensures swap risk analysis continues even without API access
- Logs warning: "Jupiter API fetch failed, using demo quote fallback"

**Why Demo Data?**
Demo data is used as a fallback to maintain application functionality during:
- Network outages
- API rate limiting
- Development/testing without API keys
- Graceful degradation when third-party services are unavailable

### 2. BirdeyeTokenSecurityProvider

**Real API Usage:**
- When `VITE_BIRDEYE_API_KEY` environment variable is present
- Calls Birdeye Token Security API for each token involved in the transaction
- Parses security data: creation time, liquidity, holder count, concentration, verification, authorities
- Analyzes against risk thresholds

**Fallback to Mock Data:**
- When `VITE_BIRDEYE_API_KEY` is not configured
- When API request fails (network error, auth failure, etc.)
- Delegates to `MockTokenSecurityProvider` which returns deterministic demo data
- Mock signals include `isMock: true` flag for transparency

**Why Demo Data?**
- Allows development and testing without requiring API keys
- Provides baseline security checks even without external API access
- Mock data is clearly labeled so users know it's not real-time data

### 3. ExternalRiskScoreProvider

**Real API Usage:**
- When `VITE_RISK_SCORE_API_URL` is configured
- Optional: `VITE_RISK_SCORE_API_KEY` for authenticated requests
- Calls external risk score API (Solana Tracker / RugCheck style)
- Parses: `normalizedScore`, `level`, `rating`, `labels`, `warnings`, `rugIndicators`
- Maps scores to risk levels (critical/severe = HIGH, medium = MEDIUM)

**Fallback Behavior:**
- When API URL is not configured: uses `MockRiskScoreProvider`
- When API fetch fails: returns "unavailable" signal (non-blocking, LOW severity)
- On network/parse errors: falls back to mock provider
- Mock signals include `isMock: true` flag

**Why Demo/Unavailable Data?**
- External risk scores are optional enhancement, not core requirement
- Unavailable scores don't block transactions (non-critical check)
- Mock data provides baseline risk assessment during development
- Graceful degradation maintains user experience

### 4. HeliusReceiptProvider

**Real API Usage:**
- When `VITE_HELIUS_API_KEY` is present
- Calls Helius Enhanced Transactions API
- Provides rich receipt data: type, fee, token transfers, native transfers
- Sets `isBasic: false` on enhanced receipts

**Fallback to Basic Receipt:**
- When API key is not configured
- When API request fails (4xx, 5xx, network error)
- Returns basic receipt with: signature, timestamp, status, explorer URL
- Sets `isBasic: true` to indicate limited data
- Explorer URLs use correct cluster (devnet/mainnet based on `VITE_SOLANA_NETWORK`)

**Why Basic Receipt?**
- Always provides transaction confirmation even without enhanced data
- Basic explorer link allows manual verification
- Non-critical enhancement - core functionality (transaction confirmation) works
- Graceful degradation for post-transaction user experience

## Configuration

All API providers use `VITE_*` prefixed environment variables:

```bash
# Jupiter Quote API (optional - defaults to public endpoint)
VITE_JUPITER_API_URL=https://quote-api.jup.ag/v6

# Birdeye Token Security (optional)
VITE_BIRDEYE_API_KEY=your_birdeye_api_key
VITE_BIRDEYE_API_URL=https://public-api.birdeye.so

# External Risk Score API (optional)
VITE_RISK_SCORE_API_URL=https://api.rugcheck.xyz
VITE_RISK_SCORE_API_KEY=your_api_key

# Helius Enhanced Receipts (optional)
VITE_HELIUS_API_KEY=your_helius_api_key
VITE_HELIUS_API_URL=https://api.helius.xyz

# Solana Network (affects explorer URLs)
VITE_SOLANA_NETWORK=devnet
```

## Testing Strategy

- Tests use mocked `fetch` to verify real API code paths
- Tests verify fallback behavior when APIs are unavailable
- Tests confirm mock/demo data is properly labeled with `isMock` flag
- Integration tests verify end-to-end behavior with and without API configuration

## User Transparency

The Safety Review UI displays:
- "DEMO DATA" badge for signals from mock providers
- Source/tool information for each risk signal
- Clear explanation of what was checked and why
- This ensures users understand when they're seeing real-time data vs. demo data
