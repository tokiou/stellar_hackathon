import { describe, expect, it } from 'vitest';

import {
  getAgentToolNames,
  evaluateSolTransferFunding,
  isReadOnlyAgentTool,
  maskSolanaAddressesForModel,
  normalizeMessages,
  parseDirectTransferIntent,
  restoreMaskedSolanaAddressesInToolArgs,
} from '../chat';
import { prepareTransferResult } from '../tools/transfer';

describe('chat agent tool catalog', () => {
  it('includes backend managed read-only context tools', () => {
    const toolNames = getAgentToolNames();
    expect(toolNames).toEqual(expect.arrayContaining(['get_wallet_holdings', 'get_usdc_sol_quote']));
    expect(isReadOnlyAgentTool('get_wallet_holdings')).toBe(true);
    expect(isReadOnlyAgentTool('get_usdc_sol_quote')).toBe(true);
    expect(isReadOnlyAgentTool('transfer')).toBe(false);
  });
});

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

describe('Solana address masking', () => {
  it('masks valid Solana addresses before sending text to the model and restores tool args', () => {
    const recipient = 'bEsfmEAaTA98rLftyi2jZ4XAzCBbqBvrJPKNW6rYJgp';
    const masked = maskSolanaAddressesForModel(`Manda 5 SOL a ${recipient}`);

    expect(masked.content).toBe('Manda 5 SOL a SOLANA_ADDRESS_1');
    expect(masked.addressByPlaceholder.SOLANA_ADDRESS_1).toBe(recipient);

    const restored = restoreMaskedSolanaAddressesInToolArgs(
      '{"amount":5,"token":"SOL","recipient":"SOLANA_ADDRESS_1"}',
      masked.addressByPlaceholder,
    );
    expect(restored).toBe(`{"amount":5,"token":"SOL","recipient":"${recipient}"}`);
  });

  it('masks address-like Solana strings even when they are malformed', () => {
    const malformedRecipient = 'iB1mdEmZixSFXKL9AoujhFfuizC8hKYCFMBzcADEQq';
    const masked = maskSolanaAddressesForModel(`Manda 1 SOL ${malformedRecipient}`);

    expect(masked.content).toBe('Manda 1 SOL SOLANA_ADDRESS_1');
    expect(masked.addressByPlaceholder.SOLANA_ADDRESS_1).toBe(malformedRecipient);
  });
});

describe('parseDirectTransferIntent', () => {
  it('parses simple transfer requests without requiring the model', () => {
    const recipient = 'bEsfmEAaTA98rLftyi2jZ4XAzCBbqBvrJPKNW6rYJgp';
    const parsed = parseDirectTransferIntent(`Manda 1 SOL ${recipient}`);

    expect(parsed).toMatchObject({
      matched: true,
      amount: 1,
      token: 'SOL',
      recipient,
      recipientValid: true,
    });
  });

  it('detects malformed recipient addresses before calling the model', () => {
    const parsed = parseDirectTransferIntent('Manda 1 SOL iB1mdEmZixSFXKL9AoujhFfuizC8hKYCFMBzcADEQq');

    expect(parsed).toMatchObject({
      matched: true,
      amount: 1,
      token: 'SOL',
      recipientValid: false,
    });
  });

  it('normalizes common SOL typos in direct transfer requests', () => {
    const recipient = 'iB1mdEmZixSFXKL9AoujhFfuizC8hKYCFMBzcADEQq2';
    const parsed = parseDirectTransferIntent(`Manda 15 sola. ${recipient}`);

    expect(parsed).toMatchObject({
      matched: true,
      amount: 15,
      token: 'SOL',
      recipient,
      recipientValid: true,
    });
  });
});

describe('prepareTransferResult', () => {
  const validFromWallet = '11111111111111111111111111111111';
  const validToWallet = 'So11111111111111111111111111111111111111112';

  it('prepares transfer for valid params', () => {
    const result = prepareTransferResult(
      { amount: 0.25, token: 'SOL', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.executedOnChain).toBe(false);
    expect(result.preparedAction?.requiresUserSignature).toBe(true);
    expect(result.preparedAction?.fromWallet).toBe(validFromWallet);
    expect(result.preparedAction?.toWallet).toBe(validToWallet);
  });

  it('denies invalid source wallet', () => {
    const result = prepareTransferResult(
      { amount: 0.25, token: 'SOL', recipient: validToWallet },
      'not-a-wallet'
    );

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_FROM_WALLET');
  });

  it('denies invalid recipient', () => {
    const result = prepareTransferResult(
      { amount: 0.25, token: 'SOL', recipient: 'not-a-wallet' },
      validFromWallet
    );

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_RECIPIENT');
  });

  it('denies non-positive amount', () => {
    const result = prepareTransferResult(
      { amount: 0, token: 'SOL', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_AMOUNT');
  });

  it('denies negative amount', () => {
    const result = prepareTransferResult(
      { amount: -1, token: 'SOL', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('INVALID_AMOUNT');
  });

  it('defaults token to SOL', () => {
    const result = prepareTransferResult(
      { amount: 1, token: '', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.token).toBe('SOL');
  });

  it('normalizes SOLA typo to SOL', () => {
    const result = prepareTransferResult(
      { amount: 1, token: 'sola', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.token).toBe('SOL');
  });

  it('denies unsupported tokens before creating a transfer proposal', () => {
    const result = prepareTransferResult(
      { amount: 1, token: 'USDC', recipient: validToWallet },
      validFromWallet
    );

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('UNSUPPORTED_TOKEN');
  });

  it('includes memo when provided', () => {
    const result = prepareTransferResult(
      { amount: 1, token: 'SOL', recipient: validToWallet, memo: 'Test memo' },
      validFromWallet
    );

    expect(result.status).toBe('prepared');
    expect(result.preparedAction?.memo).toBe('Test memo');
  });
});

describe('evaluateSolTransferFunding', () => {
  it('denies a SOL transfer when balance cannot cover amount and guardrail overhead', () => {
    const result = evaluateSolTransferFunding({
      balanceLamports: 5_000_000_000,
      amountLamports: 5_000_000_000,
      policyRentLamports: 1_000_000,
      approvalRentLamports: 2_000_000,
      feeBufferLamports: 50_000,
      policyAccountMissing: true,
    });

    expect(result.ok).toBe(false);
    expect(result.requiredLamports).toBe(5_003_050_000);
    expect(result.missingLamports).toBe(3_050_000);
  });

  it('does not include policy rent when the wallet policy already exists', () => {
    const result = evaluateSolTransferFunding({
      balanceLamports: 5_002_050_000,
      amountLamports: 5_000_000_000,
      policyRentLamports: 1_000_000,
      approvalRentLamports: 2_000_000,
      feeBufferLamports: 50_000,
      policyAccountMissing: false,
    });

    expect(result.ok).toBe(true);
    expect(result.requiredLamports).toBe(5_002_050_000);
    expect(result.overheadLamports).toBe(2_050_000);
  });
});
