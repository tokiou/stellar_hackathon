# T3 Spec — Chat con backend mockeado

> Alineado a `FRONT/docs/frontend-spec.md`.

## Objective

Implementar la experiencia de chat y el protocolo `POST /api/agent/message` con responses mockeadas/validadas.

## Scope

- Zustand store para `messages`, `pendingProposal`, `status`.
- `ChatInput` bloqueado si hay propuesta pendiente o status no idle.
- Render de `text`, `function_call`, `alert` y `text+execute`.
- Zod schemas para `AgentMessageResponse`.
- Mock backend route o mock fetch local solo contra `/api/agent/message`.

## Acceptance

- Una sola propuesta pendiente por sesión.
- Confirm/Cancel envían `function_approve`/`function_reject`.
- Risk UI se basa solo en `risk` recibido del agent.
- No se llama a providers externos desde frontend.
