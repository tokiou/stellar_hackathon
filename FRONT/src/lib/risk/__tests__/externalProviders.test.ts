import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RiskProviderInput, SwapQuote } from '../../types';
import { JupiterQuoteRiskProvider } from '../providers/JupiterQuoteRiskProvider';
import { BirdeyeTokenSecurityProvider } from '../providers/BirdeyeTokenSecurityProvider';
import { ExternalRiskScoreProvider } from '../providers/ExternalRiskScoreProvider';

describe('JupiterQuoteRiskProvider', () => {
  const provider = new JupiterQuoteRiskProvider();
  
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should block when no route found', async () => {
    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 0,
      priceImpact: 0,
      slippage: 1,
      route: '',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 0,
    };

    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
      quote,
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'BLOCKED')).toBe(true);
  });

  it('should mark HIGH risk for price impact > 10%', async () => {
    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 100,
      priceImpact: 15,
      slippage: 1,
      route: 'Route A',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 100,
    };

    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
      quote,
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'HIGH' && s.checkName.includes('price_impact'))).toBe(true);
  });

  it('should mark MEDIUM risk for price impact 3-10%', async () => {
    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 100,
      priceImpact: 5,
      slippage: 1,
      route: 'Route A',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 100,
    };

    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
      quote,
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'MEDIUM' && s.checkName.includes('price_impact'))).toBe(true);
  });

  it('should mark HIGH risk for slippage > 5%', async () => {
    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 100,
      priceImpact: 1,
      slippage: 6,
      route: 'Route A',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 100,
    };

    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 6,
      },
      quote,
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'HIGH' && s.checkName.includes('slippage'))).toBe(true);
  });

  it('should not run for transfer intents', async () => {
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: '11111111111111111111111111111111',
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals!.length).toBe(0);
  });
  
  it('should fetch real Jupiter quote and parse priceImpactPct', async () => {
    // Mock successful Jupiter API response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000000',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outAmount: '145000000',
        priceImpactPct: 0.5,
        slippageBps: 50,
        otherAmountThreshold: '144275000',
        routePlan: [
          {
            swapInfo: {
              ammKey: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
              label: 'Whirlpool',
              inputMint: 'So11111111111111111111111111111111111111112',
              outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              inAmount: '1000000000',
              outAmount: '145000000',
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 0.5,
      },
    };

    const result = await provider.assess(input);

    expect(mockFetch).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // Should have LOW risk signal for acceptable price impact (0.5%)
    expect(result.signals!.some(s => s.checkName === 'price_impact' && s.severity === 'LOW')).toBe(true);
  });
  
  it('should parse HIGH price impact from real Jupiter response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000000',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outAmount: '130000000',
        priceImpactPct: 12.5,
        slippageBps: 100,
        otherAmountThreshold: '128700000',
        routePlan: [{
          swapInfo: {
            ammKey: 'test',
            label: 'Test DEX',
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inAmount: '1000000000',
            outAmount: '130000000',
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.checkName === 'price_impact' && s.severity === 'HIGH')).toBe(true);
  });
  
  it('should fall back to demo quote when API fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);
    
    const demoQuote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 145,
      priceImpact: 0.5,
      slippage: 0.5,
      route: 'Direct',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 145,
    };
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 0.5,
      },
      quote: demoQuote,
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // Should analyze the fallback demo quote
    expect(result.signals!.some(s => s.checkName === 'price_impact')).toBe(true);
  });
  
  it('should fall back to demo quote when Jupiter API returns HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });
    vi.stubGlobal('fetch', mockFetch);

    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 0.5,
      },
      quote: {
        inputToken: 'SOL',
        outputToken: 'USDC',
        inputAmount: 1,
        estimatedOutput: 145,
        priceImpact: 0.4,
        slippage: 0.5,
        route: 'Direct',
        provider: 'demo',
        networkFeeEstimate: 0.000005,
        exchangeRate: 145,
      },
    };

    const result = await provider.assess(input);

    expect(mockFetch).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.checkName === 'price_impact' && s.severity === 'LOW')).toBe(true);
  });
  
  it('should parse multi-hop route from routePlan', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inputMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        inAmount: '10000000000',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outAmount: '220',
        priceImpactPct: 1.2,
        slippageBps: 50,
        otherAmountThreshold: '218',
        routePlan: [
          {
            swapInfo: {
              ammKey: 'test1',
              label: 'Raydium',
              inputMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
              outputMint: 'So11111111111111111111111111111111111111112',
              inAmount: '10000000000',
              outAmount: '1500000',
            },
          },
          {
            swapInfo: {
              ammKey: 'test2',
              label: 'Orca',
              inputMint: 'So11111111111111111111111111111111111111112',
              outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              inAmount: '1500000',
              outAmount: '220',
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1000000 BONK for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'BONK',
        outputToken: 'USDC',
        amount: 1000000,
        slippage: 0.5,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.checkName === 'route_complexity')).toBe(true);
  });
  
  it('should route Jupiter quote requests through BACK by default', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        inputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000000',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outAmount: '145000000',
        priceImpactPct: 0.3,
        slippageBps: 50,
        otherAmountThreshold: '144275000',
        routePlan: [{
          swapInfo: {
            ammKey: 'test',
            label: 'Whirlpool',
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inAmount: '1000000000',
            outAmount: '145000000',
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 0.5,
      },
    };

    await provider.assess(input);

    // Should call the BACK proxy endpoint instead of a public API directly
    expect(mockFetch).toHaveBeenCalled();
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain('/api/jupiter/quote');
  });
});

describe('BirdeyeTokenSecurityProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  
  it('should fall back to mock when API key not available', async () => {
    const provider = new BirdeyeTokenSecurityProvider();
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // Should use mock provider
    expect(result.signals!.some(s => s.isMock === true)).toBe(true);
  });
  
  it('should fetch Birdeye data through BACK when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          creationTime: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year old
          liquidityUsd: 100000,
          holder_count: 5000,
          top10_holder_percent: 15,
          verified: true,
          mintAuthority: false,
          freezeAuthority: false,
          mutableMetadata: false,
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const provider = new BirdeyeTokenSecurityProvider();
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: '11111111111111111111111111111111',
      },
    };

    const result = await provider.assess(input);

    expect(mockFetch).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
  });
  
  it('should fall back to mock when API request fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const provider = new BirdeyeTokenSecurityProvider();
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: '11111111111111111111111111111111',
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.isMock === true)).toBe(true);
  });
});

describe('ExternalRiskScoreProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  
  it('should fall back to mock when BACK is unavailable', async () => {
    const provider = new ExternalRiskScoreProvider();
    
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SOL for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SOL',
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // Should use mock provider
    expect(result.signals!.some(s => s.isMock === true)).toBe(true);
  });
  
  it('should fetch risk score through BACK when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        normalizedScore: 85,
        level: 'good',
        labels: ['verified', 'established'],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const provider = new ExternalRiskScoreProvider();
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: '11111111111111111111111111111111',
      },
    };

    const result = await provider.assess(input);

    expect(mockFetch).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.checkName === 'external_risk_score')).toBe(true);
  });
  
  it('should return unavailable signal when API fetch fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const provider = new ExternalRiskScoreProvider();
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: '11111111111111111111111111111111',
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals!.some(s => s.value === 'unavailable')).toBe(true);
  });
});

describe('HeliusReceiptProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  
  it('should return basic receipt when BACK is unavailable', async () => {
    const { HeliusReceiptProvider } = await import('../providers/HeliusReceiptProvider');
    const provider = new HeliusReceiptProvider();
    
    const receipt = await provider.fetchReceipt('test-signature-123');
    
    expect(receipt.signature).toBe('test-signature-123');
    expect(receipt.isBasic).toBe(true);
    expect(receipt.explorerUrl).toContain('explorer.solana.com');
  });
  
  it('should fetch enhanced receipt through BACK when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        {
          timestamp: 1640000000,
          err: null,
          fee: 5000,
          type: 'TRANSFER',
          tokenTransfers: [
            {
              mint: 'So11111111111111111111111111111111111111112',
              tokenAmount: 1000000000,
              fromUserAccount: 'sender-address',
              toUserAccount: 'recipient-address',
            },
          ],
          nativeTransfers: [],
        },
      ]),
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const { HeliusReceiptProvider } = await import('../providers/HeliusReceiptProvider');
    const provider = new HeliusReceiptProvider();
    const receipt = await provider.fetchReceipt('test-signature-123');
    
    expect(mockFetch).toHaveBeenCalled();
    expect(receipt.isBasic).toBe(false);
    expect(receipt.type).toBe('TRANSFER');
    expect(receipt.tokenTransfers).toBeDefined();
    expect(receipt.tokenTransfers!.length).toBe(1);
  });
  
  it('should fall back to basic receipt when API request fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);
    
    const { HeliusReceiptProvider } = await import('../providers/HeliusReceiptProvider');
    const provider = new HeliusReceiptProvider();
    const receipt = await provider.fetchReceipt('test-signature-123');
    
    expect(receipt.isBasic).toBe(true);
  });
});
