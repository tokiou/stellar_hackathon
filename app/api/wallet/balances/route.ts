export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  if (!address) {
    return Response.json({ error: { code: 'invalid_payload', message: 'Missing address query param.' } }, { status: 400 });
  }

  return Response.json({
    balances: [
      { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', amount: '125000000000', decimals: 9, ui_amount: 125, usd_value: 18125 },
      { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '2500000000', decimals: 6, ui_amount: 2500, usd_value: 2500 },
      { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', amount: '420000000', decimals: 6, ui_amount: 420, usd_value: 357 },
    ],
    total_usd: 20982,
    change_24h_pct: 2.4,
    updated_at: new Date().toISOString(),
  });
}
