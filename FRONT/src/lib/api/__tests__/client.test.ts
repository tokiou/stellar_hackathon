import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getHistory, streamChat } from '../client';
import { getUsdcSolQuote } from '../client';

function sseResponseFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }
  );
}

describe('streamChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses SSE events split across network chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      sseResponseFromChunks([
        'event: session\n',
        'data: {"session_id":"session-1"}\n\n',
        'event: token\ndata: {"content":"Hola"}\n\n',
        'event: done\n',
        'data: {"session_id":"session-1"}\n\n',
      ])
    );

    const events: string[] = [];

    await streamChat(
      {
        type: 'user_message',
        content: 'Hola',
      },
      {
        onSession: (sessionId) => events.push(`session:${sessionId}`),
        onToken: (content) => events.push(`token:${content}`),
        onDone: (data) => events.push(`done:${data.session_id}`),
      }
    );

    expect(events).toEqual(['session:session-1', 'token:Hola', 'done:session-1']);
  });

  it('encodes usdc-sol quote query params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          network: 'devnet',
          provider: 'orca_whirlpools_devnet',
          input_token: 'USDC',
          output_token: 'SOL',
          input_amount: 10,
          output_amount: 0.03,
          input_mint: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k',
          output_mint: 'So11111111111111111111111111111111111111112',
          slippage_bps: 100,
          updated_at: new Date().toISOString(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await getUsdcSolQuote({
      input_token: 'USDC',
      output_token: 'SOL',
      input_amount: 10,
      slippage_bps: 100,
      network: 'devnet',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/quotes/usdc-sol?input_token=USDC&output_token=SOL&input_amount=10&slippage_bps=100&network=devnet',
      expect.anything(),
    );
  });
});

describe('chat session history endpoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and parses get_history payload', async () => {
    const now = new Date().toISOString();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          session_id: 'session-1',
          user_address: 'wallet-1',
          updated_at: now,
          messages: [
            {
              role: 'agent',
              type: 'text',
              content: 'Hola',
              timestamp: now,
            },
          ],
          pending_proposal: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const payload = await getHistory('session-1');

    expect(payload.session_id).toBe('session-1');
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].type).toBe('text');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws ApiClientError for session_not_found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'session_not_found',
            message: 'session expired',
          },
        }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      ),
    );

    const error = await getHistory('expired').catch((e) => e);
    expect((error as ApiClientError).code).toBe('session_not_found');
  });
});
