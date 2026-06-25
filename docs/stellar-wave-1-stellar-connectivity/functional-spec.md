# Stellar Wave 1 — Stellar Testnet connectivity functional spec

Stellar Wave 1 stands up Stellar Testnet connectivity as a parallel "body" for Compass, analogous to the existing Solana providers under `back/services/solana/providers/`. It is pure connectivity and infrastructure: configuration, client construction, and a Friendbot funding helper. It introduces no policy logic and touches none of the brain. Solana keeps working unchanged in parallel.

## Business Problem

Compass today only knows how to reach Solana. To evaluate and co-sign actions on Stellar in later waves, Compass first needs a safe, validated way to talk to a Stellar network at all: resolve and validate network configuration, construct Horizon and Soroban clients, and fund fresh testnet accounts for demos and tests.

Without an explicit, fail-safe connectivity layer, later Stellar code risks silently defaulting to a wrong (or mainnet) network, mirroring exactly the class of mistake the Solana devnet-only guard already prevents.

## Goals

- Add the `@stellar/stellar-sdk` dependency.
- Add a Stellar network config module that reads and validates the five `STELLAR_*` environment variables.
- Make the config testnet-only and fail-safe: reject any mainnet passphrase, mirroring the Solana devnet-only guard.
- Add a Stellar connection module that constructs a Horizon `Server` client and a Soroban RPC client from validated config.
- Add a Friendbot helper that funds a fresh testnet account.
- Document the `STELLAR_*` variables in `.env.example` next to the `SOLANA_*` block.
- Cover the behavior with backend tests.

## Non-Goals

- No policy logic, scoring, or decisioning of any kind (the brain stays untouched).
- No changes to the policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS` contract, or MCP proxy.
- No changes to any Solana provider or Solana behavior.
- No classic multisig threshold evaluation or co-signer logic (Wave 6).
- No Soroban contract invocation or transaction submission.
- No mainnet support of any kind.
- No `legacy/` imports.

## User-Visible Scenarios

### Create and fund a fresh testnet account

Given a fresh Stellar testnet keypair, when the Friendbot helper funds it via `STELLAR_FRIENDBOT_URL`, then the account exists on Horizon and reports a positive XLM balance.

### Read an account's state from Horizon

Given a funded testnet account, when Compass reads it through the Horizon client, then it can observe the account's balances, signers, and thresholds.

### Missing or invalid Stellar config fails safe

Given one or more `STELLAR_*` variables are missing or invalid, when the config module resolves the network, then it throws a clear, coded error and never silently defaults to mainnet.

### A mainnet passphrase is rejected

Given `STELLAR_NETWORK_PASSPHRASE` is set to the Stellar public-network (mainnet) passphrase, when the config module validates it, then it throws a testnet-only error and refuses to build a config.

## Acceptance Criteria

- The config module validates all five `STELLAR_*` variables: `STELLAR_NETWORK`, `STELLAR_NETWORK_PASSPHRASE`, `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, `STELLAR_FRIENDBOT_URL`.
- The config module rejects any mainnet passphrase and only accepts `STELLAR_NETWORK=testnet` with the testnet passphrase `Test SDF Network ; September 2015`.
- The testnet-only guard mirrors the Solana devnet-only guard in `solanaNetworkConfig.ts` (reject the wrong network with a coded error, never default unsafely).
- `stellarConnection` exposes a Horizon `Server` client and a Soroban RPC client constructed from validated config.
- The Friendbot helper funds a testnet account and the account subsequently shows a positive XLM balance.
- `.env.example` documents the five `STELLAR_*` variables next to the `SOLANA_*` block, quoted verbatim.
- The brain is untouched and Solana behavior is unchanged.
- Existing Solana tests stay green.
- No `legacy/` imports are introduced.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

Acceptance is defined by the commands above and the criteria in this spec. No results are claimed here; this is a forward-looking planning spec and the work is not yet done.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` must define the chain-adapter boundary that this connectivity layer slots behind.
- `@stellar/stellar-sdk` is added as a new dependency in this wave.
- The Solana providers under `back/services/solana/providers/` serve as the structural precedent.

## Deferred To Later Waves

- Classic Stellar multisig account-state evaluation and co-signer / threshold logic (Wave 6).
- Soroban smart-contract invocation and transaction submission.
- Any Stellar-side policy, judging, or decision recording.
- Promotion of Friendbot funding into a hardened demo entrypoint beyond a shared helper.
- Mainnet connectivity.
