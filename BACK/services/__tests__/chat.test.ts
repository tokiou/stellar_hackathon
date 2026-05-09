import { describe, expect, it } from 'vitest';

import { normalizeMessages, inputToLangChainMessages } from '../chat';
import { prepareTransferResult } from '../tools/transfer';

describe('normalizeMessages', () => {
  it('normalizes valid messages array', () => {
    const input = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = normalizeMessages(input);
    expect(result).toHaveLength(2);
    expect(result![0].role).toBe('user');
    expect(result![1].role).toBe('assistant');
  });

  it('returns null for empty array', () => {
    expect(normalizeMessages([])).toBeNull();
  });

  it('returns null for invalid role', () => {
    const input = [{ role: 'invalid', content: 'test' }];
    expect(normalizeMessages(input)).toBeNull();
  });

  it('returns null for missing content', () => {
    const input = [{ role: 'user' }];
    expect(normalizeMessages(input)).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(normalizeMessages('not an array')).toBeNull();
    expect(normalizeMessages(null)).toBeNull();
    expect(normalizeMessages(undefined)).toBeNull();
  });
});

describe('inputToLangChainMessages', () => {
  it('converts input messages to LangChain format', () => {
    const input = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
    ];
    const result = inputToLangChainMessages(input);

    expect(result).toHaveLength(3);
    expect(result[0]._getType()).toBe('system');
    expect(result[1]._getType()).toBe('human');
    expect(result[2]._getType()).toBe('ai');
  });
});

describe('prepareTransferResult', () => {
  it('prepares transfer for valid wallets and amount', () => {
    const result = prepareTransferResult({
      fromWallet: '11111111111111111111111111111111',
      toWallet: 'So11111111111111111111111111111111111111112',
      amount: 0.25,
      tokenSymbol: 'SOL',
    });

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.executedOnChain).toBe(false);
    expect(result.preparedAction?.requiresUserSignature).toBe(true);
  });

  it('denies invalid source wallet', () => {
    const result = prepareTransferResult({
      fromWallet: 'not-a-wallet',
      toWallet: 'So11111111111111111111111111111111111111112',
      amount: 0.25,
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_FROM_WALLET');
  });

  it('denies invalid destination wallet', () => {
    const result = prepareTransferResult({
      fromWallet: '11111111111111111111111111111111',
      toWallet: 'not-a-wallet',
      amount: 0.25,
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_TO_WALLET');
  });

  it('denies non-positive amount', () => {
    const result = prepareTransferResult({
      fromWallet: '11111111111111111111111111111111',
      toWallet: 'So11111111111111111111111111111111111111112',
      amount: 0,
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_AMOUNT');
  });

  it('denies negative amount', () => {
    const result = prepareTransferResult({
      fromWallet: '11111111111111111111111111111111',
      toWallet: 'So11111111111111111111111111111111111111112',
      amount: -1,
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_AMOUNT');
  });

  it('defaults tokenSymbol to SOL', () => {
    const result = prepareTransferResult({
      fromWallet: '11111111111111111111111111111111',
      toWallet: 'So11111111111111111111111111111111111111112',
      amount: 1,
    });

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.tokenSymbol).toBe('SOL');
  });
});
