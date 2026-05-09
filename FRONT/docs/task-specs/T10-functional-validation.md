# T10 Spec — Functional validation

> Alineado a `FRONT/docs/frontend-spec.md`.

## Objective

Validar funcionalmente el frontend cuando toque implementar, sin mezclar responsabilidades backend.

## Checklist futuro

- Login con Google/Phantom Embedded muestra address Solana.
- Balances/allocation/history vienen de `/api/wallet/*`.
- Chat envía `user_message` a `/api/agent/message`.
- `function_call` bloquea input y muestra proposal/risk.
- Confirm/Cancel envían approve/reject sin payload de tx.
- `text+execute` actualiza card, libera input y refetchea wallet data.
- No hay llamadas directas a RPC/providers externos desde cliente.

## Commands

No ejecutar comandos en esta reorganización documental. Para una fase de implementación futura se podrá correr test/build/lint según el tooling vigente.
