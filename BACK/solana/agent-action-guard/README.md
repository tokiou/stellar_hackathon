# AgentActionGuard (Devnet)

Smart contract de enforcement on-chain para acciones del agente, incluyendo ejecución protegida de transferencias SOL vía `guarded_transfer` y validación de condiciones oracle para `BUY_SOL_ORACLE_CONDITIONAL`.

## Requisitos

- Solana CLI
- Anchor CLI
- Rust toolchain
- Wallet devnet con SOL

## Configuración

```bash
solana config set --url devnet
solana address
solana balance
```

## Build

```bash
cd BACK/solana/agent-action-guard
anchor build
```

## Deploy devnet

```bash
anchor deploy --provider.cluster devnet
```

Luego actualizar env backend:

```bash
AGENT_ACTION_GUARD_PROGRAM_ID=<PROGRAM_ID_DEPLOYADO>
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_SAFETY_ATTESTOR_SECRET_KEY=<BASE64_OR_JSON_SECRET_KEY>
WALLET_SAFETY_MAX_TRANSFER_SOL=20
WALLET_SAFETY_WARN_TRANSFER_SOL=5
PYTH_SOL_USD_FEED=ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
```

## Flujo oracle-gated buy

1. Front crea `create_action_approval`.
2. Front ejecuta `mark_executed_if_price_below` pasando oracle feed account.
3. Backend valida `execute_tx_signature` (`function_approve`) y responde éxito.

## Notas

- MVP mantiene compra/swap simulada.
- Validación final de condición de precio se hace on-chain.
- Para transferencias protegidas se usa `guarded_transfer`, que valida:
  - `UserPolicy` activa para el usuario.
  - `ActionApproval` derivado por `action_hash`.
  - `WalletSafetyAttestation` derivada por `user`, `recipient` y `action_hash`.
  - Coincidencia de `action_hash`, `recipient` y `amount`.
  - Expiración de `ActionApproval` y `WalletSafetyAttestation`.
- La aprobación marca `ActionApproval.executed = true` en la transacción de `guarded_transfer`.

## Attestor model

- El contrato soporta una cuenta `attestor_config` (`admin`, `attestor`).
- El `attestor` autorizado firma instrucciones `upsert_wallet_safety_attestation`.
- El backend puede emitir atestaciones con `WALLET_SAFETY_ATTESTOR_SECRET_KEY`; si no está configurada, solo puede reutilizar atestaciones ya existentes.
- `WalletSafetyAttestation` no requiere firma del backend en cada transferencia final del usuario, solo en la emisión/actualización de attestation.

## Seguridad de fallback

- No existe fallback a `SystemProgram.transfer` para `TRANSFER_SOL_GUARDED`.
- Si faltan `ActionApproval` o `WalletSafetyAttestation` válidas, el backend debe rechazar la preparación de tx para evitar bypass.
