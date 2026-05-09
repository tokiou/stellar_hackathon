# Functional Spec — Frontend aligned to `frontend-spec.md`

**Estado:** activo, resumen funcional.  
**Para qué sirve:** explicar qué experiencia de producto debe construir el frontend sin entrar en todos los detalles técnicos.  
**Historia:** reemplaza la spec funcional vieja del risk engine en frontend.

> La fuente de verdad completa es `FRONT/docs/frontend-spec.md`.

## Product goal

Construir el frontend de Wallet Copilot como un chat-first UI para operar con un agent. El usuario se autentica con Phantom Embedded + Google, ve su wallet/balances y conversa con el agent. El agent decide si ejecuta automáticamente o si necesita confirmación manual.

## Decisiones funcionales obligatorias

- Framework: Next.js 14+ App Router.
- UI: Tailwind CSS + shadcn/ui.
- Wallet: `@phantom/react-sdk` solo para login/display/export key/disconnect.
- Chain: Solana mainnet para el hackathon.
- Transacciones: el frontend **no construye, no simula, no firma y no envía** transacciones.
- Providers externos: el frontend **no llama directamente** a Jupiter, Helius, Birdeye, Solana RPC ni risk-score APIs.
- Agent/backend: toda ejecución, risk policy, quotes, receipts y provider fallback vive detrás de `/api/*` y `BACK/services/*`.

## Experiencia principal

### Pre-login

Mostrar una pantalla simple con CTA de Google/Phantom Embedded según lo defina `ConnectButton`. No hay flows multicuenta ni onramp.

### App conectada

- Desktop: shell de 3 columnas con sidebar, chat central y panel de assets/status.
- Mobile: chat-first, bottom nav para Chat/Assets/Explore/History, sidebar como drawer.
- Tabs mínimas: Chat funcional, Assets básico, History funcional, Explore placeholder.

## Protocolo agent/frontend

Todo pasa por `POST /api/agent/message`:

- `{ type: 'user_message', content, user_threshold_usd? }`
- `{ type: 'function_approve' }`
- `{ type: 'function_reject' }`

El backend responde `messages: AgentMessage[]` con:

- `text` sin `execute`: mensaje normal del agent.
- `text` con `execute`: resultado de una ejecución hecha por el agent.
- `function_call`: propuesta pendiente que bloquea el input hasta Confirm/Cancel.
- `alert`: alerta informativa/warning/danger no necesariamente asociada a una ejecución.

Solo puede existir una propuesta pendiente por sesión.

## Riesgo y safety UI

El frontend no calcula riesgo. Renderiza el `risk` incluido por el agent en cada `function_call`:

- `low`: sin alerta fuerte o badge discreto.
- `medium`: banner warning con razones.
- `critical`: banner danger; Confirm puede usar variante destructiva o requerir copy adicional si el backend lo pide en el futuro.

Cualquier explicación tipo “how we checked this” debe venir de campos del backend/agent o de copy estático; no debe implicar que el frontend ejecutó providers externos.

## Estado cliente

- Zustand: mensajes, propuesta pendiente, status del chat y settings locales.
- React Query: server state de endpoints propios (`/api/wallet/*`, `/api/network/*`, `/api/prices`).
- Phantom SDK: estado de conexión, addresses, connect/disconnect/export key.

`pendingProposal` no se persiste; un refresh cancela implícitamente la propuesta activa.

## Endpoints consumidos por el frontend

- `POST /api/agent/message`
- `GET /api/wallet/balances`
- `GET /api/wallet/allocation`
- `GET /api/wallet/transactions`
- `GET /api/network/status`
- `GET /api/prices`

Ningún documento de frontend debe introducir endpoints directos como `/api/jupiter/*`, `/api/helius/*`, llamadas RPC desde cliente o variables `VITE_*` de providers.

## Fuera de alcance hackathon

- Dark mode.
- Multichain.
- Websockets.
- Push notifications.
- Explore funcional.
- Multi-cuenta.
- i18n completo.
- Tests como prioridad principal.
- Animaciones complejas.
- Onramp/fiat.
