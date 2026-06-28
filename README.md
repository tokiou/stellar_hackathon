# Compass

Compass is the **execution firewall for AI agents on Stellar**.

It sits between AI agents, MCP tools, wallets, and the Stellar network. Before any sensitive operation is signed or executed, Compass decodes the transaction, classifies the operation, applies policy, optionally consults an LLM judge, asks for human approval when required, and records the decision in an audit trail.

Compass is **not** another AI wallet. Wallets control signing. Compass decides **whether an agent action should reach signing at all** — and, as a **policy-gated co-signer**, it enforces that decision cryptographically using **Stellar's native multisig**: if Compass does not add its signature, the account threshold is not met and the network rejects the transaction. No custody, no bypass.

## Why Stellar

The policy gate is enforced by the ledger itself. The account is configured (via `setOptions`) so that the user and Compass are both required signers (master weight 1 + Compass weight 1, medium threshold 2). A transaction the user signs but Compass refuses to co-sign is **rejected by the network** (`tx_bad_auth`) — there is no separate enforcement contract to deploy and nothing to bypass.

## Architecture

Two layers, cleanly separated:

- **The chain-agnostic brain** — MCP proxy with policy interceptor, LLM judge with sanitizer, deterministic policy engine, audit trail, and the `ALLOW / DENY / ESCALATE` decision contract. It consumes neutral facts; it never parses XDR or touches keys.
- **The Stellar layer** (`back/services/stellar/`) — Horizon/Soroban connectivity, XDR → semantic-facts decoder, operation→risk mapping, the policy-gated co-signer, and multisig audit metadata. It plugs into the brain through a neutral `ChainAdapter` boundary.

The decision maps onto the signature:

| Decision | Co-signer behavior | On-network outcome |
|----------|--------------------|--------------------|
| **ALLOW** | Compass adds its signature | threshold met → executes |
| **DENY** | Compass does not sign | threshold unmet → tx dead |
| **ESCALATE** | Compass withholds for human review | not executable until approved |

## Repository shape

```
compass/
├── back/services/
│   ├── chain/            # Neutral ChainAdapter boundary + registry
│   ├── stellar/          # Stellar layer:
│   │   ├── providers/    #   Horizon/Soroban connection, network config, Friendbot
│   │   ├── transactions/ #   XDR decoder, stroop amounts
│   │   ├── operations/   #   operation → actionKind/riskClass mapping + policy context
│   │   ├── signer/        #   policy-gated co-signer (local + Privy) + provisioning
│   │   ├── audit/        #   multisig audit metadata
│   │   └── demo/         #   guard pipeline + multisig setup
│   └── mcp/              # MCP proxy server (chain-agnostic)
├── hosted/               # Hosted backend: evaluation, policy engine, judge, audit
├── shared/types/         # Neutral contracts (chain, decision, policy, audit)
├── scripts/              # Demos, MCP launcher, Privy setup
└── docs/                 # Specs (stellar-wave-0..7, stellar-privy-signer)
```

## Quick start

### Prerequisites

- Node.js 18+
- Git
- Public internet access to Stellar Testnet (Horizon + Friendbot). No real funds — Friendbot funds test accounts.

### Setup

```sh
git clone <repo-url>
cd compass
npm install
cp .env.example .env.local
```

The Stellar defaults already point at Testnet; you only need to set the network passphrase (and a signer if you want Compass to co-sign — see **Signer providers**).

```sh
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

### Run the end-to-end demo on Testnet

Drives the full thesis: create + fund an account via Friendbot, configure native multisig, and run the demo cases (ALLOW executes, DENY/ESCALATE are rejected).

```sh
npx tsx scripts/stellar-demo.mjs
```

### Run tests

```sh
npm run test:back
```

## Signer providers (how Compass co-signs)

Compass needs **its own** Stellar key to co-sign (it never holds the user's/agent's key). The provider is `COMPASS_STELLAR_SIGNER_PROVIDER` and **Privy is mandatory by default** (`privy`) — Compass's co-signing key is custodied by Privy; Compass never holds a raw seed. With no signer configured, Compass still evaluates and decides; it just can't add its signature (fail-closed: the threshold stays unmet → the network rejects).

### `privy` (default, mandatory) — key custodied by Privy

Compass's co-signing key lives in a Privy server wallet (TEE-isolated); Compass signs by calling Privy's raw-sign API and never sees the secret.

1. Get `PRIVY_APP_ID` + `PRIVY_APP_SECRET` from https://dashboard.privy.io (enable Server Wallets).
2. Create the wallet + authorization key in one command:

   ```sh
   PRIVY_APP_ID=... PRIVY_APP_SECRET=... npx tsx scripts/privy-setup.mjs
   ```

   It prints the env block to paste:

   ```sh
   export COMPASS_STELLAR_SIGNER_PROVIDER=privy
   export PRIVY_APP_ID=...
   export PRIVY_APP_SECRET=...
   export COMPASS_STELLAR_PRIVY_WALLET_ID=...
   export COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY=G...
   export PRIVY_AUTHORIZATION_KEY='...'    # P-256 key, keep secret
   ```

3. Verify Compass co-signs via real Privy on Testnet:

   ```sh
   npx tsx scripts/stellar-privy-cosign-demo.mjs
   # ALLOW  -> Privy signs -> executable
   # ESCALATE -> Privy does not sign -> rejected (tx_bad_auth)
   ```

> Dev-only escape hatch: a `local` raw-seed signer exists for development behind `COMPASS_ALLOW_LOCAL_SIGNER=true` (+ `COMPASS_STELLAR_SIGNER_ENABLED=true`, `COMPASS_STELLAR_SIGNER_SECRET=S…`). Without it, selecting `local` throws `PRIVY_REQUIRED`.

## Account setup (one-time, by the funds owner)

Co-signing requires the account to be a **2-of-2 multisig**: the owner configures it (via `setOptions`) so that the **agent's key** and **Compass's key** are both required signers (threshold 2). Neither moves funds alone.

- The **agent's key** gives the agent autonomy to sign its own transactions. The owner provisions it (e.g. a Privy wallet for the agent); **Compass never holds it**.
- **Compass's key** is the policy gate (the Privy server wallet above). Compass signs only on `ALLOW`.
- The owner keeps ultimate control (master key) and can re-configure signers any time.

If the agent's key is compromised, funds are still safe — without Compass's policy-gated co-signature the threshold is never met.

## Run as an MCP firewall (with Claude or any MCP client)

Compass is an MCP **proxy**: it wraps a downstream Stellar MCP server and gates every tool call. A ready launcher wraps the public [`stellar-mcp`](https://www.npmjs.com/package/stellar-mcp) server:

```json
{
  "mcpServers": {
    "compass-stellar": {
      "command": "bash",
      "args": ["/absolute/path/compass/scripts/compass-stellar-mcp.sh"],
      "env": { "STELLAR_SERVER_URL": "https://horizon-testnet.stellar.org" }
    }
  }
}
```

Put your Privy config in a **gitignored** `.compass-privy.env` at the repo root (the launcher sources it):

```sh
COMPASS_STELLAR_SIGNER_PROVIDER=privy
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
COMPASS_STELLAR_PRIVY_WALLET_ID=...
COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY=G...   # Compass's CO-SIGNER key (added to the account as a required signer)
PRIVY_AUTHORIZATION_KEY=...                     # P-256, authorizes raw-sign (secret)
COMPASS_STELLAR_ALLOWLIST=G...,G...             # recipient addresses that resolve to ALLOW
```

### How co-signing works through the proxy (real 2-of-2)

Compass is a **co-signer**, not a custodian of the agent's key:

- The agent **signs the transaction with its own wallet** (a key Compass never sees) on the 2-of-2 account, then presents the **agent-signed transaction** to the proxy (an `envelopeXdr` argument).
- The proxy decodes it, runs policy, and on **ALLOW** adds **Compass's** signature (via Privy) and submits → `agent + Compass = 2 signatures` → executes. On **DENY/ESCALATE**, Compass does not co-sign → the tx stays at 1 signature → the network rejects it (`tx_bad_auth`).
- Before co-signing, the proxy **verifies the account is genuinely 2-of-2**: Compass's key must be a required signer and the threshold must be ≥ 2 (no single signer can move funds). If not, it **refuses to co-sign**.
- A transaction the agent did **not** sign first is rejected (Compass only co-signs).
- A call carrying a **raw key** (`secretKey`, `seed`, `privateKey`, …) or an **unsigned fund-moving** Stellar intent is **blocked** — never forwarded to a self-signing downstream.
- **Read-only** tools (`stellar_balance`, `stellar_transactions`) are forwarded to the downstream.
- The override is scoped to `stellar_*` / `soroban_*` tools; other downstream tools go through the normal proxy gate.

Restart your MCP client so the proxy relaunches with the config.

## Live dashboard

A zero-dependency dashboard shows, in real time, what the proxy **allowed / denied /
escalated** and whether **Privy** co-signed.

```sh
COMPASS_EVENTS_FILE=.compass-events.jsonl node scripts/compass-dashboard.mjs
# open http://localhost:4173
```

The proxy launcher already sets `COMPASS_EVENTS_FILE` to the same
`.compass-events.jsonl`, so every decision streams to the page (SSE): a
color-coded table (ALLOW green / DENY red / ESCALATE amber), a **🔐 Privy** badge
+ txHash when Compass co-signed, and running counters. Use the MCP via your agent
and watch decisions appear live.

## Environment variables

Copy `.env.example` to `.env.local`. Stellar URLs default to Testnet.

### Stellar network

| Variable | Description |
|----------|-------------|
| `STELLAR_NETWORK` | `testnet` (testnet-only; a mainnet passphrase is rejected) |
| `STELLAR_NETWORK_PASSPHRASE` | required — `Test SDF Network ; September 2015` |
| `STELLAR_HORIZON_URL` | Horizon endpoint (default Testnet) |
| `STELLAR_RPC_URL` | Soroban RPC endpoint (default Testnet) |
| `STELLAR_FRIENDBOT_URL` | Friendbot funding endpoint (default Testnet) |
| `FALLBACK_XLM_USD_PRICE` | Stub XLM/USD price for amount thresholds (default `0.1`) |

### Co-signer (Privy mandatory by default)

| Variable | Description |
|----------|-------------|
| `COMPASS_STELLAR_SIGNER_PROVIDER` | `privy` (default & required) or `local` (dev-only) |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Privy app credentials |
| `COMPASS_STELLAR_PRIVY_WALLET_ID` | Compass's Privy server wallet id |
| `COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY` | Compass's co-signer `G…` address (registered on the account as a required signer) |
| `PRIVY_AUTHORIZATION_KEY` | P-256 authorization key to authorize raw-sign (secret) |
| `COMPASS_STELLAR_ALLOWLIST` | comma-separated recipient `G…` addresses that resolve to ALLOW |
| `COMPASS_ALLOW_LOCAL_SIGNER` | dev-only: set `true` to permit the `local` raw-seed signer |
| `COMPASS_STELLAR_SIGNER_ENABLED` / `COMPASS_STELLAR_SIGNER_SECRET` | `local` dev signer (only with the escape hatch above) |

### Dashboard / proxy feed

| Variable | Description |
|----------|-------------|
| `COMPASS_EVENTS_FILE` | JSONL decision feed the proxy appends and the dashboard tails |
| `COMPASS_DASHBOARD_PORT` | dashboard HTTP port (default `4173`) |

### Hosted backend / hybrid guard

| Variable | Description |
|----------|-------------|
| `COMPASS_HOSTED_PORT` | hosted backend port (default `3001`) |
| `COMPASS_HOSTED_API_KEY` | API key for local hosted auth |
| `COMPASS_HYBRID_GUARD_ENABLED` | run mutating calls through the hosted policy engine (default `true`) |
| `COMPASS_HOSTED_API_URL` | hosted backend URL (default `http://localhost:3001`) |

### LLM judge / router (optional, advisory)

| Variable | Description |
|----------|-------------|
| `COMPASS_LLM_DECISION_ENABLED` | enable the optional advisory LLM judge (default `false`) |
| `COMPASS_LLM_ROUTER_ENABLED` | enable tool-call classification router (default `false`) |

### Debug

| Variable | Description |
|----------|-------------|
| `COMPASS_DEBUG` | comma-separated modules: `proxy`, `policy`, `gateway`, `execution`, `interceptor`, `llm`, `signer`, `connection`, `audit` |

## Scripts

| Command | Description |
|---------|-------------|
| `npx tsx scripts/stellar-demo.mjs` | Full Testnet demo: fund → multisig → run cases |
| `npx tsx scripts/stellar-privy-cosign-demo.mjs` | Mode B co-signer demo (real Privy if configured) |
| `npx tsx scripts/privy-setup.mjs` | One-time real Privy wallet + authorization key setup |
| `npx tsx scripts/stellar-privy-provision.mjs` | Provision (onboard) an agent's Stellar wallet via Privy |
| `node scripts/compass-dashboard.mjs` | Live guard dashboard (allow/deny/escalate + Privy badge) |
| `npm run test:back` | Backend test suite (vitest) |
| `npm run mcp:dev` | Start the Compass MCP proxy (stdio) |

## Demo cases

1. Legit payment within policy → **ALLOW** (Compass co-signs, executes on Testnet)
2. Payment to a non-authorized destination → **DENY**
3. Amount out of range → **ESCALATE**
4. Critical operation (`setOptions` / `changeTrust`) → **ESCALATE**
5. User signs but Compass does not → **not executable** (network rejects)
6. User + Compass sign → **executable**

## Security rules

- Sensitive operations must pass the policy gate before Compass co-signs.
- Missing evidence, unsafe policy state, or unverifiable high-risk actions fail closed (no signature → threshold unmet → not executable).
- Compass never holds the user's private key. With the `privy` provider, Compass never holds its own key either — Privy custodies it.
- Testnet-only: a mainnet network passphrase is rejected.

## Source of truth

- [`docs/stellar-support/`](docs/stellar-support/) — Stellar wave track overview and specs.
- [`docs/stellar-privy-signer/`](docs/stellar-privy-signer/) — Privy co-signer, provisioning, and test guides.
- [`docs/PRODUCT_CONSTITUTION.md`](docs/PRODUCT_CONSTITUTION.md) — canonical product document.
