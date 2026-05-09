export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody =
  | { type: 'user_message'; content: string; user_threshold_usd?: number }
  | { type: 'function_approve' }
  | { type: 'function_reject' };

function now() {
  return new Date().toISOString();
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'invalid_payload', message: 'Invalid JSON payload.' } }, { status: 400 });
  }

  if (body.type === 'function_approve') {
    return Response.json({
      messages: [
        {
          type: 'text',
          content: 'Done. The agent executed the approved transaction.',
          execute: { status: 'success', tx_hash: '5xYdemo111111111111111111111111111111111111111111111111111' },
          timestamp: now(),
        },
      ],
    });
  }

  if (body.type === 'function_reject') {
    return Response.json({ messages: [{ type: 'text', content: 'OK, cancelled.', timestamp: now() }] });
  }

  if (body.type !== 'user_message' || !body.content?.trim()) {
    return Response.json({ error: { code: 'invalid_payload', message: 'Expected user_message content.' } }, { status: 400 });
  }

  const text = body.content.toLowerCase();
  const threshold = body.user_threshold_usd ?? 20;
  const large = /\b(5|10|20|50|100)\s*sol\b/.test(text) || text.includes('large') || threshold <= 1;

  if (text.includes('send') || text.includes('transfer')) {
    return Response.json({
      messages: [
        {
          type: 'function_call',
          function: {
            name: 'transfer',
            params: {
              amount: text.includes('usdc') ? 25 : 0.1,
              token: text.includes('usdc') ? 'USDC' : 'SOL',
              recipient: '7vW4m2Qq9YxDemoRecipient111111111111111111111',
            },
          },
          display: { summary: 'Send 0.1 SOL to 7vW4...1111', fee_usd: 0.01, provider: 'Wallet Copilot Agent' },
          risk: { score: 42, level: 'medium', reasons: ['New recipient address', 'Please verify the destination before approving'] },
          timestamp: now(),
        },
      ],
    });
  }

  if (large) {
    return Response.json({
      messages: [
        {
          type: 'alert',
          severity: 'warning',
          content: 'Network congestion is elevated. Fees may be slightly higher than usual.',
          timestamp: now(),
        },
        {
          type: 'function_call',
          function: {
            name: 'swap',
            params: { amount_in: 5, token_in: 'SOL', token_out: 'USDC', slippage_bps: 50 },
          },
          display: { summary: 'Swap 5 SOL → ~725 USDC', fee_usd: 0.04, provider: 'Jupiter via Agent', slippage_bps: 50 },
          risk: { score: 65, level: 'medium', reasons: ['Amount is above your auto-confirm threshold', 'Slippage tolerance is 0.5%'] },
          timestamp: now(),
        },
      ],
    });
  }

  return Response.json({
    messages: [
      {
        type: 'text',
        content: 'Swapped 0.1 SOL for ~14.50 USDC.',
        execute: { status: 'success', tx_hash: '3autoDemo11111111111111111111111111111111111111111111111' },
        timestamp: now(),
      },
    ],
  });
}
