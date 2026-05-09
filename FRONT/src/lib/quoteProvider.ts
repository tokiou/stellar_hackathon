import type {
  ParsedSwapIntent,
  ParsedTransferIntent,
  SwapQuote,
  TransferPreview,
  AllowedToken,
} from './types';
import { TOKEN_REGISTRY } from './tokens';

/**
 * Mock quote provider for demo mode.
 * Structured so Jupiter API can be plugged in later by replacing these functions.
 */

/** Simulate a swap quote using demo prices */
export function getSwapQuote(intent: ParsedSwapIntent): SwapQuote {
  const inputInfo = TOKEN_REGISTRY[intent.inputToken];
  const outputInfo = TOKEN_REGISTRY[intent.outputToken];

  const exchangeRate = inputInfo.demoPrice / outputInfo.demoPrice;

  // Simulate price impact based on amount (larger = more impact)
  const priceImpact = simulatePriceImpact(intent.inputToken, intent.amount);

  // Apply price impact to output
  const rawOutput = intent.amount * exchangeRate;
  const impactMultiplier = 1 - priceImpact / 100;
  const slippageMultiplier = 1 - intent.slippage / 100;
  const estimatedOutput = rawOutput * impactMultiplier * slippageMultiplier;

  return {
    inputToken: intent.inputToken,
    outputToken: intent.outputToken,
    inputAmount: intent.amount,
    estimatedOutput: parseFloat(estimatedOutput.toFixed(outputInfo.decimals > 2 ? 6 : 2)),
    priceImpact: parseFloat(priceImpact.toFixed(2)),
    slippage: intent.slippage,
    route: `${intent.inputToken} → ${intent.outputToken}`,
    provider: 'Demo quote (mock)',
    networkFeeEstimate: 0.000005, // ~5000 lamports
    exchangeRate: parseFloat(exchangeRate.toFixed(6)),
  };
}

/** Simulate a transfer preview */
export function getTransferPreview(
  intent: ParsedTransferIntent,
  senderAddress: string,
): TransferPreview {
  return {
    token: intent.token,
    amount: intent.amount,
    sender: senderAddress,
    recipient: intent.recipient,
    networkFeeEstimate: intent.token === 'SOL' ? 0.000005 : 0.00001, // SOL transfer cheaper than SPL
  };
}

/**
 * Simulate price impact.
 * In production, this would come from Jupiter or a DEX aggregator.
 */
function simulatePriceImpact(token: AllowedToken, amount: number): number {
  const info = TOKEN_REGISTRY[token];
  const usdValue = amount * info.demoPrice;

  // Simulate: larger trades = more impact
  if (usdValue < 10) return 0.05;
  if (usdValue < 100) return 0.15;
  if (usdValue < 500) return 0.5;
  if (usdValue < 1000) return 1.2;
  if (usdValue < 5000) return 3.5;
  return 8.0 + (usdValue / 10000);
}

/**
 * Format token amount for display.
 */
export function formatTokenAmount(amount: number, token: AllowedToken): string {
  const info = TOKEN_REGISTRY[token];
  if (token === 'BONK') {
    return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (info.demoPrice < 1) {
    return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (info.demoPrice >= 100) {
    return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}