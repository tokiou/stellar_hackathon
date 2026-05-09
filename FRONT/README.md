# FRONT

Código frontend/client-side de la app Next.

- Componentes: `FRONT/src/components`
- Pages internas heredadas: `FRONT/src/pages`
- Hooks: `FRONT/src/hooks`
- Lógica de UI/client: `FRONT/src/lib`

El entrypoint real de Next está en `app/page.tsx`, que importa `FRONT/src/App.tsx`.

No poner secrets acá. Si una integración necesita API key, crear/usar una ruta en `app/api/*` y lógica server-side en `BACK/services/*`.
