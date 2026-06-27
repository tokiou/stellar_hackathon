# Test the Compass proxy with Claude (Stellar MCP) — funded wallet ready

A Testnet wallet is **already funded** (10,000 XLM via Friendbot). The proxy intercepts every
call **before** the wallet is used, so for BLOCK tests you don't even need the secret.

- Funded account (public): `GCNS64QYNFCNQNK3ND3ABF47WRHI3LUSTHT22PCH2XJXKRIOZOYNQ427`
- Destination (public):     `GA2K7B5FNXZBVCQGBW5RR4HFHDRNW35VRJTZ4WRA2VY4ED752W2WC6JL`
- Secret key: in `.stellar-demo-wallet.json` (gitignored — never committed).

`stellar-mcp` takes the signing key as a **tool argument** (`secretKey`), not env — so the
wallet can't be baked into the server config; paste it only when you want a call to actually execute.

## 1. Approve the MCP
`claude mcp list` → approve `compass-stellar` (project `.mcp.json`). Status should become ✔ Connected.

## 2. Ask Claude these (verified results)

| Ask Claude | Tool + args | Compass result |
| --- | --- | --- |
| "Get the balance of `GCNS64QYNFCNQNK3ND3ABF47WRHI3LUSTHT22PCH2XJXKRIOZOYNQ427`" | `stellar_balance { account }` | **ALLOW → forwarded**, returns 10000 XLM ✓ |
| "Send 5 XLM to `GA2K7B5FNXZBVCQGBW5RR4HFHDRNW35VRJTZ4WRA2VY4ED752W2WC6JL`" | `stellar_payment { destination, amount, secretKey }` | **DENY — blocked by Compass** ✓ |
| "Change a trustline" | `stellar_change_trust` | **blocked (require_approval/deny)** |
| "Deploy a Soroban contract" | `soroban_deploy` | **blocked** |

Control vs block: balance passes; payment/changeTrust/deploy are gated. That's the proxy working.

> With `COMPASS_HYBRID_GUARD_ENABLED=false` (current), mutating tools are denied fail-closed —
> enough to show blocking. For full ALLOW/ESCALATE-by-amount, run `npm run hosted:dev` and set
> the hosted env + `=true`.
