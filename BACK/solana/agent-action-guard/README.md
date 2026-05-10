# AgentActionGuard (Devnet)

Smart contract de approvals on-chain para acciones del agente, incluyendo:
- `BUY_SOL_ORACLE_CONDITIONAL` con validación de precio oracle.
- guard de swap por desviación de precio vs oracle (`mark_executed_if_swap_price_within_band`).

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
PYTH_SOL_USD_FEED=ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
```

## Flujo oracle-gated buy

1. Front crea `create_action_approval`.
2. Front ejecuta `mark_executed_if_price_below` pasando oracle feed account.
3. Backend valida `execute_tx_signature` (`function_approve`) y responde éxito.

## Notas

- MVP mantiene compra/swap simulada.
- Validación final de condición de precio se hace on-chain.

## Flujo swap con price-band guard (nuevo)

1. Front crea `create_action_approval` para acción de tipo swap (`SimulatedSwap` en esta versión).
2. Front ejecuta `mark_executed_if_swap_price_within_band` pasando:
   - `quoted_price_usd_e8`
   - `max_deviation_bps`
   - `staleness_seconds`
   - `max_confidence_bps`
   - cuenta `oracle_price_feed` (Pyth SOL/USD)
3. Si la desviación entre precio cotizado y oracle supera el umbral, la instrucción falla y no marca ejecución.
