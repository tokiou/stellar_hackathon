export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  if (!address) {
    return Response.json({ error: { code: 'invalid_payload', message: 'Missing address query param.' } }, { status: 400 });
  }

  return Response.json({
    transactions: [
      {
        tx_hash: '5xYdemo111111111111111111111111111111111111111111111111111',
        type: 'swap',
        status: 'success',
        timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        summary: 'Swapped 0.5 SOL → 72.5 USDC',
        amount_usd: 72.5,
        explorer_url: 'https://explorer.solana.com/',
      },
      {
        tx_hash: '4sendDemo1111111111111111111111111111111111111111111111',
        type: 'transfer',
        status: 'success',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        summary: 'Sent 10 USDC',
        amount_usd: 10,
        explorer_url: 'https://explorer.solana.com/',
      },
    ],
  });
}
