# Compass proxy + Stellar MCP downstream — config & what to test

This wires the Compass MCP **proxy** in front of a **real, existing** Stellar MCP server
(`stellar-mcp`, stdio, on npm — `syronlabs/stellar-mcp`) so Compass intercepts every Stellar tool
call. No custom downstream was written; the existing one is reused.

## The downstream

`stellar-mcp` exposes these stdio tools:

- Classic: `stellar_create_account`, `stellar_balance`, `stellar_payment`, `stellar_transactions`,
  `stellar_create_asset`, `stellar_change_trust`, `stellar_create_claimable_balance`,
  `stellar_claim_claimable_balance`, `stellar_fund_account`
- Soroban: `soroban_build_and_optimize`, `soroban_deploy`, `soroban_retrieve_contract_methods`

Run standalone: `STELLAR_SERVER_URL=https://horizon-testnet.stellar.org npx -y stellar-mcp`

## MCP client config (Compass proxying stellar-mcp)

```json
{
  "mcpServers": {
    "compass-stellar": {
      "command": "npx",
      "args": [
        "-y", "@ramadan04/compass-mcp-guard",
        "--downstream-name", "stellar-tools",
        "--downstream-command", "npx",
        "--downstream-args-json", "[\"-y\",\"stellar-mcp\"]",
        "--downstream-env-keys", "STELLAR_SERVER_URL"
      ],
      "env": {
        "STELLAR_SERVER_URL": "https://horizon-testnet.stellar.org",
        "COMPASS_HYBRID_GUARD_ENABLED": "true"
      }
    }
  }
}
```

Local dev (without npx-publishing Compass): point `--downstream-command` at `npx` + `stellar-mcp`
and start the Compass server via `npm run mcp:dev -- --downstream-command npx --downstream-args-json '["-y","stellar-mcp"]' --downstream-env-keys STELLAR_SERVER_URL`.

## What to test — and what Compass actually does today

These are the **verified** prefilter classifications (run via the proxy interceptor on the real
tool names). The proxy gates by **tool name**, before the call reaches the downstream:

| Tool to call | Compass prefilter | Meaning |
| --- | --- | --- |
| `stellar_balance` | **allow** | read-only — forwarded ✓ |
| `stellar_payment` | **require_approval** | mutation gated — NOT forwarded without approval ✓ |
| `stellar_change_trust` | **require_approval** | critical op gated ✓ |
| `stellar_create_account` | **require_approval** | gated ✓ |
| `stellar_create_asset` | **require_approval** | gated ✓ |
| `stellar_transactions` | **require_approval** | gated (conservative) |
| `soroban_deploy` | **require_approval** | gated ✓ |
| `stellar_fund_account` | allow | testnet faucet — harmless, but technically a mutation |
| `stellar_claim_claimable_balance` | **allow** ⚠️ | **GAP: moves funds but is auto-allowed** |

### Try these to see Compass block:
1. Ask the agent to **send a payment** (`stellar_payment`) → Compass returns `require_approval`, the
   call is **not forwarded** to stellar-mcp.
2. Ask it to **change a trustline** (`stellar_change_trust`) or **deploy a contract**
   (`soroban_deploy`) → `require_approval`.
3. Ask for a **balance** (`stellar_balance`) → **allowed** and forwarded (control case).

### Honest gaps (verified, not hidden)
- The proxy prefilter classifies by **tool name tokens** (`send`/`swap`/`transfer`/`approve`/…),
  which are Solana/EVM-flavored. Stellar's verbs (`payment`, `change_trust`) are **not** in those
  sets, so the dangerous tools land in **`require_approval` (unknown)** rather than precise
  allow/deny — safe (nothing auto-forwards), but coarse.
- **`stellar_claim_claimable_balance` is mis-allowed**: it moves funds but matches the read verb
  "balance". This is a real classification gap to fix (add Stellar mutation verbs to the
  interceptor token sets).
- The proxy path does **not** yet run the Wave 2/3 Stellar decode→policy pipeline
  (`runStellarGuard`), so per-amount / per-recipient decisions (ALLOW/DENY/ESCALATE) are not applied
  at the proxy — only name-based gating is. Wiring `runStellarGuard` into the dispatcher is the
  follow-up that makes proxy decisions as precise as the demo.
