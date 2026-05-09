# BACK

Código backend/server-side para la app Next.

Esta carpeta **no** corre como servidor separado. La lógica vive en `BACK/services/*` y es llamada por los route handlers estándar de Next en `app/api/*`.

Ejemplo:

```txt
app/api/birdeye/token-security/route.ts -> BACK/services/birdeye.ts
```

Así mantenemos separación física `FRONT` / `BACK`, pero Vercel deploya todo como una sola Next fullstack app.

## Variables

Configurar en Vercel o `.env.local` en la raíz:

- `JUPITER_API_URL`
- `BIRDEYE_API_KEY`
- `BIRDEYE_API_URL`
- `RISK_SCORE_API_URL`
- `RISK_SCORE_API_KEY`
- `HELIUS_API_KEY`
- `HELIUS_API_URL`
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL` (opcional, default `gpt-4.1-mini`)
- `OPENAI_API_URL` (opcional, default `https://api.openai.com/v1`)
