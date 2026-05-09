import { describe, it, expect } from 'vitest';
import type { RiskProviderInput } from '../../types';
import { MockTokenSecurityProvider } from '../providers/MockTokenSecurityProvider';
import { MockRiskScoreProvider } from '../providers/MockRiskScoreProvider';

describe('Mock Providers', () => {
  describe('MockTokenSecurityProvider', () => {
    it('should return mock data with isMock flag', async () => {
      const provider = new MockTokenSecurityProvider();
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
      expect(result.signals!.length).toBeGreaterThan(0);
      expect(result.signals![0].isMock).toBe(true);
    });

    it('should include source name in signals', async () => {
      const provider = new MockTokenSecurityProvider();
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
      
      expect(result.signals![0].source).toContain('Mock');
    });
  });

  describe('MockRiskScoreProvider', () => {
    it('should return mock risk score with isMock flag', async () => {
      const provider = new MockRiskScoreProvider();
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
      expect(result.signals!.length).toBeGreaterThan(0);
      expect(result.signals![0].isMock).toBe(true);
    });

    it('should return deterministic demo scores', async () => {
      const provider = new MockRiskScoreProvider();
      const input: RiskProviderInput = {
        intent: {
          action: 'swap',
          originalText: 'swap 1 BONK for SOL',
          confidence: 'high',
          timestamp: Date.now(),
          inputToken: 'BONK',
          outputToken: 'SOL',
          amount: 1000000,
          slippage: 1,
        },
      };
      
      const result = await provider.assess(input);
      
      expect(result.status).toBe('success');
      expect(result.signals).toBeDefined();
      // BONK should have a demo score
      expect(result.signals![0].value).toBeDefined();
    });
  });
});

describe('Provider Interface Contract', () => {
  it('should enforce RiskProvider interface', () => {
    const provider = new MockTokenSecurityProvider();
    
    expect(provider.name).toBeDefined();
    expect(provider.source).toBeDefined();
    expect(typeof provider.assess).toBe('function');
  });

  it('should return proper RiskProviderResult structure', async () => {
    const provider = new MockTokenSecurityProvider();
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
    
    expect(result).toHaveProperty('status');
    expect(['success', 'unavailable', 'failed']).toContain(result.status);
    
    if (result.status === 'success') {
      expect(result).toHaveProperty('signals');
      expect(Array.isArray(result.signals)).toBe(true);
    }
  });
});
