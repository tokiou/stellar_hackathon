import { describe, it, expect } from 'vitest';
import type { RiskProviderInput } from '../../types';
import { TransactionSimulationProvider } from '../providers/TransactionSimulationProvider';
import { HeliusReceiptProvider } from '../providers/HeliusReceiptProvider';

describe('TransactionSimulationProvider', () => {
  it('should return not-yet-simulated signal when no transaction prepared', async () => {
    const provider = new TransactionSimulationProvider();
    
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
      // No preparedTransaction
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.length).toBeGreaterThan(0);
    expect(result.signals![0].checkName).toBe('simulation_status');
    expect(result.signals![0].severity).toBe('LOW');
  });

  it('should block when simulation fails', async () => {
    const provider = new TransactionSimulationProvider();
    
    // Mock transaction that will fail simulation
    const mockTransaction = {
      serialize: () => Buffer.from([]),
    };

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
      preparedTransaction: mockTransaction,
      connection: {
        simulateTransaction: async () => ({
          value: { err: 'Simulation failed', logs: [] },
        }),
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.some(s => s.severity === 'BLOCKED')).toBe(true);
  });

  it('should pass when simulation succeeds', async () => {
    const provider = new TransactionSimulationProvider();
    
    const mockTransaction = {
      serialize: () => Buffer.from([]),
    };

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
      preparedTransaction: mockTransaction,
      connection: {
        simulateTransaction: async () => ({
          value: { err: null, logs: ['Success'] },
        }),
      },
    };

    const result = await provider.assess(input);

    expect(result.status).toBe('success');
    expect(result.signals).toBeDefined();
    expect(result.signals!.every(s => s.severity !== 'BLOCKED')).toBe(true);
  });
});

describe('HeliusReceiptProvider', () => {
  it('should return basic receipt when Helius not configured', async () => {
    const provider = new HeliusReceiptProvider();
    const signature = '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7';

    const receipt = await provider.fetchReceipt(signature);

    expect(receipt).toBeDefined();
    expect(receipt.signature).toBe(signature);
    expect(receipt.explorerUrl).toContain(signature);
    expect(receipt.isBasic).toBe(true);
  });

  it('should include timestamp and status', async () => {
    const provider = new HeliusReceiptProvider();
    const signature = '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7';

    const receipt = await provider.fetchReceipt(signature);

    expect(receipt.timestamp).toBeDefined();
    expect(receipt.timestamp).toBeGreaterThan(0);
    expect(receipt.status).toBeDefined();
    expect(['success', 'failed']).toContain(receipt.status);
  });

  it('should use devnet explorer URL in dev mode', async () => {
    const provider = new HeliusReceiptProvider();
    const signature = '5j7s6NiJS3JAkvgkoc18WVAsiSaci2pxB2A6ueCJP4tprA2TFg9wSyTLeYouxPBJEMzJinENTkpA52YStRW5Dia7';

    const receipt = await provider.fetchReceipt(signature);

    // Should use devnet by default in this environment
    expect(receipt.explorerUrl).toContain('devnet');
  });
});
