import { describe, it, expect } from 'vitest';
import { assessRisk } from '../../riskEngine';
import type { ParsedIntent, SwapQuote } from '../../types';

describe('Risk Engine Integration', () => {
  it('should assess swap intent with providers', async () => {
    const intent: ParsedIntent = {
      action: 'swap',
      originalText: 'swap 1 SOL for USDC',
      confidence: 'high',
      timestamp: Date.now(),
      inputToken: 'SOL',
      outputToken: 'USDC',
      amount: 1,
      slippage: 1,
    };

    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 100,
      priceImpact: 1,
      slippage: 1,
      route: 'Direct',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 100,
    };

    const assessment = await assessRisk(intent, quote);

    expect(assessment).toBeDefined();
    expect(assessment.level).toBeDefined();
    expect(assessment.reasons).toBeDefined();
    expect(assessment.reasons.length).toBeGreaterThan(0);
    expect(assessment.providerResults).toBeDefined();
  });

  it('should assess transfer intent with providers', async () => {
    const intent: ParsedIntent = {
      action: 'transfer',
      originalText: 'send 1 SOL to 11111111111111111111111111111111',
      confidence: 'high',
      timestamp: Date.now(),
      token: 'SOL',
      amount: 1,
      recipient: '11111111111111111111111111111111',
    };

    const assessment = await assessRisk(intent);

    expect(assessment).toBeDefined();
    expect(assessment.level).toBeDefined();
    expect(assessment.reasons).toBeDefined();
    expect(assessment.providerResults).toBeDefined();
  });

  it('should block low confidence intents', async () => {
    const intent: ParsedIntent = {
      action: 'swap',
      originalText: 'maybe swap',
      confidence: 'low',
      timestamp: Date.now(),
      inputToken: 'SOL',
      outputToken: 'USDC',
      amount: 1,
      slippage: 1,
    };

    const assessment = await assessRisk(intent);

    expect(assessment.level).toBe('BLOCKED');
  });

  it('should include signals alias for backward compatibility', async () => {
    const intent: ParsedIntent = {
      action: 'swap',
      originalText: 'swap 1 SOL for USDC',
      confidence: 'high',
      timestamp: Date.now(),
      inputToken: 'SOL',
      outputToken: 'USDC',
      amount: 1,
      slippage: 1,
    };

    const assessment = await assessRisk(intent);

    expect(assessment.signals).toBeDefined();
    expect(assessment.signals).toBe(assessment.reasons);
  });

  it('should aggregate multiple provider signals correctly', async () => {
    const intent: ParsedIntent = {
      action: 'swap',
      originalText: 'swap 1 SOL for USDC',
      confidence: 'high',
      timestamp: Date.now(),
      inputToken: 'SOL',
      outputToken: 'USDC',
      amount: 1,
      slippage: 1,
    };

    const quote: SwapQuote = {
      inputToken: 'SOL',
      outputToken: 'USDC',
      inputAmount: 1,
      estimatedOutput: 100,
      priceImpact: 1,
      slippage: 1,
      route: 'Direct',
      provider: 'jupiter',
      networkFeeEstimate: 0.000005,
      exchangeRate: 100,
    };

    const assessment = await assessRisk(intent, quote);

    // Should have signals from multiple providers
    const providerNames = new Set(
      assessment.reasons.map(r => r.source || r.checkName)
    );
    expect(providerNames.size).toBeGreaterThan(1);
  });
});
