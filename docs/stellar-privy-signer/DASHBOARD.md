# Compass dashboard — live guard view

A zero-dependency dashboard that visualizes, in real time, what the proxy
**allowed / denied / escalated**. The proxy writes each decision to a JSONL feed
(`COMPASS_EVENTS_FILE`); the dashboard tails it and streams to the browser (SSE).

## Run it (alongside the MCP proxy)

1. Start the dashboard:
   ```bash
   COMPASS_EVENTS_FILE=.compass-events.jsonl node scripts/compass-dashboard.mjs
   # → http://localhost:4173
   ```
2. Use the proxy via Claude (the `compass-stellar` launcher already sets
   `COMPASS_EVENTS_FILE` to the same `.compass-events.jsonl`). Ask the agent to:
   - "get the balance of G…"  → **ALLOW** (green) appears
   - "send a payment"          → **DENY** (red)
   - amount out of range / setOptions (with hosted backend) → **ESCALATE** (amber)

The page shows a live, color-coded table (time, decision, tool, reason) and
running counters for allow / deny / escalate.

## How it works
- `back/services/mcp/proxy/proxyEventLog.ts` appends one JSON line per decision
  when `COMPASS_EVENTS_FILE` is set (no-op otherwise; never breaks the proxy).
- The dispatcher emits on every `callTool` result, so allow/deny/escalate are all captured.
- `scripts/compass-dashboard.mjs` serves the page and an SSE `/events` endpoint
  that tails the feed file.

## Notes
- The "Privy activated" signal only lights up once co-signing runs inside the
  proxy flow. Today the proxy forwards mutations to the self-signing downstream
  (`stellar-mcp`), so the feed shows the decision (allow/deny/escalate), not a
  Privy co-signature. Wiring `runStellarGuard` (Privy co-sign) into the proxy's
  ALLOW path is the follow-up that adds a real Privy column.

## UPDATE: Privy co-signing wired into the proxy (verified on Testnet)

With `COMPASS_STELLAR_PROXY_EXECUTE=true` + Privy configured, the proxy no longer
forwards Stellar mutations (`stellar_payment`) to the self-signing downstream.
Instead Compass builds the tx from the Privy wallet, runs the guard
(decode→policy), and on ALLOW **co-signs with Privy and submits**. The dashboard
then shows a "🔐 Privy" signer badge + txHash on that row.

Verified on Testnet through the proxy: `stellar_payment` → ALLOW → Privy signed →
submitted (real txHash), feed event `{ outcome:"allow", signer:"privy", txHash }`.
Reads (`stellar_balance`) still forward to the downstream (override returns null).

Enable with:
```
COMPASS_STELLAR_PROXY_EXECUTE=true
COMPASS_STELLAR_SIGNER_PROVIDER=privy
PRIVY_APP_ID / PRIVY_APP_SECRET / COMPASS_STELLAR_PRIVY_WALLET_ID /
COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY / PRIVY_AUTHORIZATION_KEY
COMPASS_STELLAR_ALLOWLIST=<known recipient G-addrs, comma-separated>
```
The Privy wallet must be funded on Testnet (it is the payment source).
