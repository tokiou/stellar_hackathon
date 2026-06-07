/**
 * Tiny env + HTTP helpers shared by Compass MCP Guard backend code.
 *
 * Previously called `upstream.ts`. Renamed in Wave 3.5 because the new
 * direction does not have an "upstream" concept (the chat proxy is going
 * to legacy/) and the actual purpose is reading env vars and shaping
 * fetch responses.
 *
 * The legacy tree keeps its own copy as `legacy/back/services/upstream.ts`
 * so the chat-app code can continue to import it unchanged.
 */

export function getEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

export async function passthrough(upstream: Response) {
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}
