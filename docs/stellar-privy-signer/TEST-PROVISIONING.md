# Privy onboarding — provision an agent's Stellar wallet (independent + MCP-validatable)

Provisions a Stellar (Ed25519) server wallet via Privy. The logic lives in
`back/services/stellar/signer/privyProvisioning.ts` and works INDEPENDENTLY of any MCP.
Real Privy when `PRIVY_APP_ID`/`PRIVY_APP_SECRET` are set; simulated (local Ed25519 + StrKey)
otherwise, so the flow is validatable now.

## 1. Validate independently (no MCP)
```bash
npx tsx scripts/stellar-privy-provision.mjs              # prints walletId + G… address
FUND_ON_TESTNET=true npx tsx scripts/stellar-privy-provision.mjs   # also funds it on Testnet
```
Verified: returns a valid Stellar `G…` address; with FUND_ON_TESTNET it exists on the ledger.

## 2. Validate from an MCP (onboarding MCP exposes it as a tool)
Run the onboarding MCP and call `provision_stellar_wallet`:
```bash
npx tsx scripts/stellar-onboarding-mcp.mjs
```
Or behind the Compass proxy (register as a downstream) and ask Claude:
> "Provision a Stellar wallet for the agent using provision_stellar_wallet"

Note: through the Compass proxy the tool name is unknown → the proxy gates it
(require_approval) like any mutating tool; approve it to let it through. The provisioning
itself is identical whether called directly or via MCP.

## 3. Real Privy
Set `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (https://dashboard.privy.io) and run either command —
it auto-switches to `provider: "privy"` and calls `wallets().create({ chain_type: "stellar" })`.
The returned wallet's address (or raw public key, StrKey-encoded) becomes the agent's
`COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY` for the Mode B co-signer.
