# Stellar Privy signer — functional spec

This feature adds a **Privy-custodied** co-signer for Compass on Stellar, as an alternative to the Wave 4 local-keypair co-signer. Instead of holding a raw secret seed in `COMPASS_STELLAR_SIGNER_SECRET`, Compass's co-signing key lives in a Privy server wallet (TEE-isolated, with Privy signing policies), and Compass signs by calling Privy's raw-sign API. It implements the same `CompassStellarCosigner` contract from Wave 4, so the rest of the system is unchanged.

## Business Problem

Wave 4 proved the policy-gated co-signer thesis with a local keypair. For anything beyond a demo, holding the co-signer secret as a plaintext env var is the weak point: key material sits in process env, shell history, and deploy config. The `PRODUCT_CONSTITUTION.md` names a `PrivyAdapter` as the intended production signer. This feature delivers it: Compass becomes an additional multisig signer whose key is never exposed to Compass — Privy custodies it and signs on request.

## Goals

- A `PrivyStellarCosigner` implementing the existing `CompassStellarCosigner` interface (`getPublicKey`, `cosign`, `inspectAccount`).
- Signing via Privy server wallets: raw-sign the Stellar transaction hash (Ed25519) and attach the signature.
- A provider selector (`COMPASS_STELLAR_SIGNER_PROVIDER=local|privy`) so local (Wave 4) and Privy coexist; default stays `local` for the existing demo.
- Same policy gate as Wave 4: sign ONLY on the brain's `ALLOW`; enforce envelope-to-candidate binding; never submit.
- Testnet-only guard; fail-closed when Privy config is missing.
- No secret material (app secret, authorization key) ever appears in results, audit, or logs.

## Non-Goals

- No change to the brain (policy engine, judge, sanitizer, `COMPASS_DECISIONS`, MCP proxy).
- No change to Wave 4's local co-signer behavior; Privy is additive and opt-in.
- No Privy *embedded/user-side* wallet login flow — this is the **server-side co-signer** only.
- No mainnet; no production key-management/quorum policy design beyond what Privy provides.
- No EVM/Solana Privy signer in this feature (Stellar Ed25519 raw-sign only).

## User-Visible Scenarios

### Compass co-signs via Privy on ALLOW
Given `COMPASS_STELLAR_SIGNER_PROVIDER=privy` and valid Privy config, when the brain returns `ALLOW`, then Compass raw-signs the transaction hash through Privy and returns the augmented XDR carrying Compass's signature — without ever holding the secret.

### Privy signer withholds on DENY/ESCALATE
Given a non-`ALLOW` decision, when `cosign` is called, then it returns `POLICY_NOT_ALLOWED` and calls Privy not at all.

### Fail-closed when Privy is not configured
Given `COMPASS_STELLAR_SIGNER_PROVIDER=privy` but a missing app id/secret/wallet, when `cosign` is called, then it returns `COMPASS_SIGNER_NOT_CONFIGURED` and signs nothing (so the multisig threshold stays unmet — not executable).

### Mainnet is refused
Given a mainnet network passphrase, when the Privy signer initializes, then it returns `COMPASS_SIGNER_MAINNET_FORBIDDEN`.

### Binding is enforced
Given an `expectedEnvelopeFingerprint` that does not match the envelope, when `cosign` is called, then it returns `ENVELOPE_CANDIDATE_MISMATCH` and does not call Privy.

## Acceptance Criteria

- `PrivyStellarCosigner` satisfies `CompassStellarCosigner` and is selectable via `COMPASS_STELLAR_SIGNER_PROVIDER=privy`.
- The signature it attaches is a valid Stellar Ed25519 signature over `tx.hash()` for the configured wallet public key (verifiable by the Stellar SDK).
- Gating, binding, testnet-only guard, and fail-closed config behave exactly as the Wave 4 local signer.
- The Privy app secret / authorization key never appears in any `CosignResult`, audit metadata, or log.
- The demo and all existing tests still pass; the brain and Solana are untouched.
- No `legacy/` imports.

## Verification

- `npm run test:back`
- `npm run lint`
- `npx tsc --noEmit --pretty false`

## Dependencies

- `stellar-wave-4-cosigning-multisig` — the `CompassStellarCosigner` contract and gating semantics this reuses.
- Runtime: `@privy-io/node` (Privy server SDK) plus a Privy app (id + secret) and a Stellar server wallet. Tests mock the Privy client and need none of these.

## Deferred

- Privy user-side embedded wallets (the "user" signer) and login flows.
- EVM/Solana Privy signers.
- Privy signing-policy / quorum configuration as code.
- Mainnet readiness.
