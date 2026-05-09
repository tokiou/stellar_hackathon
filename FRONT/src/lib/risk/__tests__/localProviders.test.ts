import { describe, it, expect } from 'vitest';
import type { AllowedToken, RiskProviderInput } from '../../types';
import { LocalAllowlistProvider } from '../providers/LocalAllowlistProvider';
import { RecipientValidationProvider } from '../providers/RecipientValidationProvider';

describe('LocalAllowlistProvider', () => {
  const provider = new LocalAllowlistProvider();

  it('should allow known tokens', async () => {
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
    expect(result.signals!.every(s => s.severity !== 'BLOCKED')).toBe(true);
  });

  it('should block unknown token symbols', async () => {
    const input: RiskProviderInput = {
      intent: {
        action: 'swap',
        originalText: 'swap 1 SCAM for USDC',
        confidence: 'high',
        timestamp: Date.now(),
        inputToken: 'SCAM' as unknown as AllowedToken,
        outputToken: 'USDC',
        amount: 1,
        slippage: 1,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'BLOCKED')).toBe(true);
  });

  it('should verify all MVP tokens are allowed', async () => {
    const tokens = ['SOL', 'USDC', 'BONK', 'JUP', 'PYTH'];
    
    for (const token of tokens) {
      const input: RiskProviderInput = {
        intent: {
          action: 'transfer',
          originalText: `send 1 ${token}`,
          confidence: 'high',
          timestamp: Date.now(),
          token: token as AllowedToken,
          amount: 1,
          recipient: 'DemoRecipient',
        },
      };

      const result = await provider.assess(input);
      
      expect(result.status).toBe('success');
      expect(result.signals!.every(s => s.severity !== 'BLOCKED')).toBe(true);
    }
  });
});

describe('RecipientValidationProvider', () => {
  const provider = new RecipientValidationProvider();

  it('should block invalid Solana public keys', async () => {
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL to invalid-address',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: 'invalid-address',
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'BLOCKED')).toBe(true);
    expect(result.signals!.some(s => s.checkName === 'recipient_validation')).toBe(true);
  });

  it('should accept valid Solana public keys', async () => {
    const validAddress = '11111111111111111111111111111111';
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: `send 1 SOL to ${validAddress}`,
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: validAddress,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.every(s => s.severity !== 'BLOCKED')).toBe(true);
  });

  it('should mark new addresses as MEDIUM risk', async () => {
    const validAddress = '11111111111111111111111111111111';
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: `send 1 SOL to ${validAddress}`,
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: validAddress,
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // New address should be MEDIUM
    expect(result.signals!.some(s => s.severity === 'MEDIUM')).toBe(true);
  });

  it('should handle .sol domain names as blocked for now', async () => {
    const input: RiskProviderInput = {
      intent: {
        action: 'transfer',
        originalText: 'send 1 SOL to alice.sol',
        confidence: 'high',
        timestamp: Date.now(),
        token: 'SOL',
        amount: 1,
        recipient: 'alice.sol',
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    // .sol names should be blocked until SNS is implemented
    expect(result.signals!.some(s => s.severity === 'BLOCKED')).toBe(true);
  });

  it('should only run for transfer intents', async () => {
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
    expect(result.signals!.length).toBe(0); // No signals for swaps
  });
});
