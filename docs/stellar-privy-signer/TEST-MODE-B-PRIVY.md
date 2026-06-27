# Test Modo B — Compass co-signs via Privy (Stellar Testnet)

Modo B is the multisig co-signer: the user signs, and Compass adds its signature
ONLY on ALLOW. Compass's key is the Privy server wallet — Compass never holds the secret.
Without Compass's (Privy's) signature, the account threshold is unmet and the network rejects.

This is SEPARATE from the MCP proxy (Modo A): Privy is the signer, not the gatekeeper.

## Run it now (simulated Privy, real Testnet)

```bash
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export FALLBACK_XLM_USD_PRICE=0.1
npx tsx scripts/stellar-privy-cosign-demo.mjs
```

Verified output:
- Multisig set: Compass (Privy) is a required signer (threshold 2).
- CASE 1 ALLOW: decision=ALLOW, Privy signed=true,  on-network=**executable**
- CASE 2 ESCALATE: decision=ESCALATE, Privy signed=false, on-network=**rejected (tx_bad_auth)**

"Simulated Privy" = a local Ed25519 keypair stands in for Privy's TEE rawSign. The Compass
signing code path (createPrivyStellarCosigner → rawSign → attach) is identical to real Privy;
only the key custody is local in this mode.

## Run it for real (your Privy account)

1. Create an app at https://dashboard.privy.io → get PRIVY_APP_ID + PRIVY_APP_SECRET.
2. Create a Stellar server wallet in Privy → get its walletId and public key (G...).
3. Export and run the same script — it auto-switches to REAL Privy when these are set:

```bash
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export PRIVY_APP_ID=...
export PRIVY_APP_SECRET=...
export COMPASS_STELLAR_PRIVY_WALLET_ID=...
export COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY=G...
npx tsx scripts/stellar-privy-cosign-demo.mjs
```

The full six-case demo also honors the provider switch:
`COMPASS_STELLAR_SIGNER_PROVIDER=privy npx tsx scripts/stellar-demo.mjs` (with the same PRIVY_* env).
