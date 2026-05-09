import type { AllowedToken, TokenInfo } from './types';

/**
 * Token registry for the MVP allowlist.
 * Mint addresses are mainnet canonical addresses.
 * Demo prices are approximate and for mock quote generation only.
 */
export const TOKEN_REGISTRY: Record<AllowedToken, TokenInfo> = {
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    coingeckoId: 'solana',
    demoPrice: 145.0,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    coingeckoId: 'usd-coin',
    demoPrice: 1.0,
  },
  BONK: {
    symbol: 'BONK',
    name: 'Bonk',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    decimals: 5,
    coingeckoId: 'bonk',
    demoPrice: 0.000022,
  },
  JUP: {
    symbol: 'JUP',
    name: 'Jupiter',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    decimals: 6,
    coingeckoId: 'jupiter-exchange-solana',
    demoPrice: 0.85,
  },
  PYTH: {
    symbol: 'PYTH',
    name: 'Pyth Network',
    mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    decimals: 6,
    coingeckoId: 'pyth-network',
    demoPrice: 0.32,
  },
};

export const ALLOWED_SYMBOLS = Object.keys(TOKEN_REGISTRY) as AllowedToken[];

export function isAllowedToken(symbol: string): symbol is AllowedToken {
  return ALLOWED_SYMBOLS.includes(symbol.toUpperCase() as AllowedToken);
}

export function getTokenInfo(symbol: AllowedToken): TokenInfo {
  return TOKEN_REGISTRY[symbol];
}

/** Get the approximate USD value of an amount of a token (demo mode) */
export function getDemoUsdValue(symbol: AllowedToken, amount: number): number {
  return TOKEN_REGISTRY[symbol].demoPrice * amount;
}

/** Get the approximate SOL-equivalent value (demo mode) */
export function getDemoSolEquivalent(symbol: AllowedToken, amount: number): number {
  const usdValue = getDemoUsdValue(symbol, amount);
  return usdValue / TOKEN_REGISTRY.SOL.demoPrice;
}
