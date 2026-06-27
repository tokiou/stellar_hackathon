# Stellar Privy signer — technical spec

Implements a Privy-custodied co-signer that satisfies the Wave 4 `CompassStellarCosigner` contract. The only new signing mechanism is Privy's raw-sign (Ed25519); everything else (gating, binding, testnet guard, audit) is the Wave 4 behavior, reused.

## Architecture

```txt
runStellarGuard / demo / proxy
  -> resolveStellarCosigner(env)            [NEW selector]
       COMPASS_STELLAR_SIGNER_PROVIDER=local  -> createStellarCosigner (Wave 4, raw seed)
       COMPASS_STELLAR_SIGNER_PROVIDER=privy  -> createPrivyStellarCosigner (NEW)
                                                   |
                                                   v
       cosign(envelopeXdr, decision):
         gate on ALLOW + binding (shared)
         tx = TransactionBuilder.fromXDR(xdr, passphrase)
         hashHex = "0x" + tx.hash().toString("hex")        (32-byte sig base)
         sig = PrivyClient.wallets().rawSign(walletId, { params: { hash: hashHex } })
         tx.addSignature(walletPublicKey, sigBase64)        (Ed25519, validated by SDK)
         return tx.toXDR()
```

Privy custodies the key; Compass never sees the secret. The public key (G…) is configured, not fetched, so signing needs no extra round-trip.

## Files

| File | Role |
| --- | --- |
| `back/services/stellar/signer/privyClient.ts` | NEW. Structural `PrivyWalletClient` interface (`rawSign`) + a lazy factory that constructs the real `@privy-io/node` client from env; injectable for tests. |
| `back/services/stellar/signer/privyStellarCosigner.ts` | NEW. `createPrivyStellarCosigner(deps)` implementing `CompassStellarCosigner` via Privy raw-sign. |
| `back/services/stellar/signer/stellarCosignerFactory.ts` | NEW. `resolveStellarCosigner(env, deps)` selecting local vs privy by `COMPASS_STELLAR_SIGNER_PROVIDER`. |
| `back/services/stellar/signer/__tests__/privyStellarCosigner.test.ts` | NEW. Mocks the Privy client with a real Ed25519 keypair; asserts a valid attached signature, gating, binding, fail-closed config, secret non-exposure. |
| `back/services/stellar/signer/stellarCosigner.ts` | EXISTING (Wave 4). Reused for the local provider and for the shared gate helper. |
| `.env.example` | Add the `COMPASS_STELLAR_SIGNER_PROVIDER` + `PRIVY_*` / wallet vars. |

## Contracts

```ts
// privyClient.ts — the minimal surface we use of @privy-io/node
export interface PrivyWalletClient {
  // Returns a 64-byte Ed25519 signature for the given 0x-hex hash.
  rawSign(walletId: string, input: { params: { hash: string } }): Promise<{ signature: string } | string>;
}

export type PrivyStellarConfig = {
  appId: string;
  appSecret: string;       // secret — never logged or returned
  walletId: string;
  walletPublicKey: string; // Stellar G… address of the Privy server wallet (public)
};
```

`createPrivyStellarCosigner({ env, client, loadAccount })` returns the Wave 4 `CompassStellarCosigner`. `client`/`loadAccount` are injectable; in production `client` is the lazily-built `@privy-io/node` client and `loadAccount` reads Horizon (as Wave 4).

## Behavior

- **Provider selection.** `resolveStellarCosigner` reads `COMPASS_STELLAR_SIGNER_PROVIDER` (default `local`). `local` → Wave 4 `createStellarCosigner` (unchanged). `privy` → `createPrivyStellarCosigner`.
- **Config resolution (privy).** Requires `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `COMPASS_STELLAR_PRIVY_WALLET_ID`, `COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY`, plus the testnet passphrase. Any missing → `COMPASS_SIGNER_NOT_CONFIGURED`. Mainnet passphrase → `COMPASS_SIGNER_MAINNET_FORBIDDEN`.
- **Gate + binding.** Identical to Wave 4: non-`ALLOW` → `POLICY_NOT_ALLOWED` (Privy not called); `expectedEnvelopeFingerprint` mismatch → `ENVELOPE_CANDIDATE_MISMATCH` (Privy not called).
- **Sign.** Parse XDR, compute `tx.hash()` (the 32-byte signature base), hex-encode as `0x…`, call `rawSign(walletId, { params: { hash } })`, normalize the returned 64-byte signature (hex or `0x`-hex), and attach via `tx.addSignature(walletPublicKey, sigBase64)`. The SDK validates the signature against the hash and the public key; an invalid signature throws → `COSIGN_FAILED`.
- **getPublicKey.** Returns the configured wallet public key, or `null` when unconfigured. Never the secret.
- **inspectAccount.** Same as Wave 4 (Horizon read of signers/weights/threshold) — custody of the co-signer key is independent of reading account state.
- **Secret hygiene.** `appSecret` is held only inside the client closure; it is never placed in `CosignResult`, audit metadata, or logs.

## Tests

- `rawSign` mock backed by a real Ed25519 keypair → the attached signature verifies against the wallet public key over `tx.hash()` (signature is genuinely valid, not a stub).
- Non-`ALLOW` decision → `POLICY_NOT_ALLOWED`, mock `rawSign` never called.
- Fingerprint mismatch → `ENVELOPE_CANDIDATE_MISMATCH`, `rawSign` never called.
- Missing any Privy var → `COMPASS_SIGNER_NOT_CONFIGURED`.
- Mainnet passphrase → `COMPASS_SIGNER_MAINNET_FORBIDDEN`.
- `JSON.stringify(result)` contains neither the app secret nor the wallet id-derived secret material.
- `resolveStellarCosigner` returns the local signer by default and the Privy signer when selected.
- No `legacy/` import in any new file.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- Wave 4 `stellarCosignerContracts.ts` / `stellarCosigner.ts`.
- `@stellar/stellar-sdk` (`TransactionBuilder.fromXDR`, `tx.hash()`, `tx.addSignature`).
- `@privy-io/node` at runtime only; tests inject a fake `PrivyWalletClient`.

## Deferred

- Real Privy network call in CI (needs a Privy app + server wallet; kept manual, like the Wave 6 testnet run).
- Privy signing policies / multi-approver quorum configuration.
- Privy user-side wallets and EVM/Solana signers.
