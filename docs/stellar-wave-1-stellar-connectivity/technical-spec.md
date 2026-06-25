# Stellar Wave 1 — Stellar Testnet connectivity technical spec

This spec describes the connectivity/infrastructure layer for Stellar Testnet inside Compass. It mirrors the existing Solana providers (`back/services/solana/providers/solanaConnection.ts` and `solanaNetworkConfig.ts`) and slots behind the chain-adapter boundary introduced in Stellar Wave 0. It contains no policy logic. The brain (policy engine, LLM judge, sanitizer, `COMPASS_DECISIONS` contract, MCP proxy) stays untouched, and Solana keeps working unchanged in parallel.

## Architecture

```txt
env (STELLAR_* vars)
  -> stellarNetworkConfig.ts
       resolve + validate network (testnet-only)
       reject any mainnet passphrase  (mirrors solanaNetworkConfig devnet guard)
       -> StellarNetworkConfig { network, passphrase, horizonUrl, rpcUrl, friendbotUrl }
            -> stellarConnection.ts
                 getHorizonServer()  -> Horizon Server client
                 getSorobanRpc()     -> Soroban RPC client
            -> friendbot.ts
                 fundTestnetAccount(publicKey) -> funds via STELLAR_FRIENDBOT_URL

(Solana providers untouched, in parallel)
back/services/solana/providers/{solanaNetworkConfig,solanaConnection}.ts
```

## Files

| File | Role |
| --- | --- |
| `back/services/stellar/providers/stellarNetworkConfig.ts` | Reads and validates the five `STELLAR_*` env vars; testnet-only fail-safe guard that rejects mainnet passphrases. |
| `back/services/stellar/providers/stellarConnection.ts` | Constructs a Horizon `Server` client and a Soroban RPC client from validated config. |
| `back/services/stellar/providers/friendbot.ts` | Helper that funds a testnet account via Friendbot; usable by tests and the Wave 6 demo script. |
| `.env.example` | Documents the five `STELLAR_*` vars next to the existing `SOLANA_*` block (edit only). |
| `back/services/stellar/providers/__tests__/*.test.ts` | Backend tests for config validation, client construction, and Friendbot funding. |

## Contracts

```ts
export type StellarNetwork = 'testnet';

export type StellarNetworkConfig = {
  network: StellarNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  rpcUrl: string;
  friendbotUrl: string;
};

export type StellarNetworkErrorCode =
  | 'unsupported_network'
  | 'missing_network_config'
  | 'invalid_network_config'
  | 'mainnet_forbidden';

export function getStellarNetworkConfig(network?: string | null): StellarNetworkConfig;
export function isSupportedStellarNetwork(network: string | undefined | null): network is StellarNetwork;
```

```ts
// stellarConnection.ts
export function getHorizonServer(): import('@stellar/stellar-sdk').Horizon.Server;
export function getSorobanRpc(): import('@stellar/stellar-sdk').rpc.Server;

// friendbot.ts
export function fundTestnetAccount(publicKey: string): Promise<{ funded: boolean }>;
```

## Behavior

### Config (`stellarNetworkConfig.ts`)

- Mirrors `solanaNetworkConfig.ts`: a coded `Error` factory, a `resolve*` guard, and a `get*Config` builder.
- The only accepted network is `testnet`; any other value throws `unsupported_network`.
- The accepted passphrase is exactly `Test SDF Network ; September 2015`. Any mainnet passphrase (e.g. the Stellar public-network passphrase) throws `mainnet_forbidden`. This is the testnet-only analogue of the Solana devnet-only guard.
- Reads `STELLAR_NETWORK`, `STELLAR_NETWORK_PASSPHRASE`, `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, `STELLAR_FRIENDBOT_URL`. Trims values. Missing required values throw `missing_network_config`; malformed values throw `invalid_network_config`.
- Never silently defaults to mainnet.

Expected `.env.example` values (verbatim):

```txt
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_FRIENDBOT_URL=https://friendbot.stellar.org
```

### Connection (`stellarConnection.ts`)

- Mirrors `solanaConnection.ts`: lazy, singleton clients constructed from validated config.
- `getHorizonServer()` constructs a Horizon `Server` from `horizonUrl`.
- `getSorobanRpc()` constructs a Soroban RPC `Server` from `rpcUrl`.
- Horizon is primary for classic Stellar multisig account-state reads (balances, signers, thresholds); Soroban RPC is for smart-contract calls in later waves.

### Friendbot (`friendbot.ts`)

- `fundTestnetAccount(publicKey)` calls `STELLAR_FRIENDBOT_URL` to fund the account.
- Designed as a shared helper usable both by tests and by the Wave 6 demo script.
- Surfaces a clear error if funding fails; does not swallow failures.

## Tests

Planned backend coverage (RED-first, no results claimed here):

- Config accepts `testnet` + the exact testnet passphrase and returns all five fields.
- Config throws `unsupported_network` for any non-`testnet` value.
- Config throws `mainnet_forbidden` for a mainnet passphrase.
- Config throws `missing_network_config` / `invalid_network_config` for missing or malformed vars.
- `getHorizonServer()` and `getSorobanRpc()` return clients built from the validated config.
- `fundTestnetAccount` funds a fresh testnet account and the account then shows a positive XLM balance.
- No `legacy/` import appears in any new Stellar file.
- Existing Solana provider tests remain green (regression).

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

This is a planning spec; acceptance is the commands above plus the functional-spec criteria. No test outcomes are asserted.

## Dependencies

- `stellar-wave-0-chain-adapter-boundary` (the boundary these providers slot behind).
- New dependency: `@stellar/stellar-sdk`.
- Structural precedent: `back/services/solana/providers/solanaConnection.ts`, `solanaNetworkConfig.ts`.

## Deferred To Later Waves

- Classic multisig account-state evaluation, signer/threshold co-signing (Wave 6, reads via Horizon).
- Soroban contract invocation and transaction submission.
- Any Stellar-side policy, judge, or decision recording.
- Hardened demo entrypoint built on top of the Friendbot helper.
- Mainnet connectivity.
