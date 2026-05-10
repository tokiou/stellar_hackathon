import { describe, expect, it } from 'vitest';
import {
  AgentMessageResponseSchema,
  GetBalancesResponseSchema,
  FunctionApproveResponseSchema,
  FunctionExecutionSchema,
  ConditionalBuySolParamsSchema,
  TransactionPayloadSchema,
  SSEProposalSchema,
} from '../schemas';

describe('api schemas', () => {
  it('validates an agent function_call response', () => {
    const parsed = AgentMessageResponseSchema.parse({
      messages: [
        {
          type: 'function_call',
          function: {
            name: 'swap',
            params: { amount_in: 5, token_in: 'SOL', token_out: 'USDC' },
          },
          display: { summary: 'Swap 5 SOL → ~725 USDC', fee_usd: 0.04, provider: 'Agent' },
          risk: { score: 65, level: 'medium', reasons: ['Above threshold'] },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    expect(parsed.messages[0].type).toBe('function_call');
  });

  it('validates approve response with transaction payload', () => {
    const parsed = AgentMessageResponseSchema.parse({
      messages: [
        {
          type: 'text',
          content: 'Transfer prepared. Sign in your wallet to execute.',
          timestamp: new Date().toISOString(),
        },
      ],
      transaction: {
        format: 'base64_versioned_transaction',
        unsigned_tx_base64: 'dGVzdA==', // "test" in base64
        recent_blockhash: 'abc123',
        last_valid_block_height: 12345,
        network: 'devnet',
      },
    });

    expect(parsed.messages[0].type).toBe('text');
    expect(parsed.transaction).toBeDefined();
    expect(parsed.transaction?.format).toBe('base64_versioned_transaction');
    expect(parsed.transaction?.unsigned_tx_base64).toBe('dGVzdA==');
  });

  it('validates swap execution response with transaction', () => {
    const parsed = AgentMessageResponseSchema.parse({
      messages: [
        {
          type: 'text',
          content: 'Swap prepared: 10 USDC → SOL. Sign to execute.',
          timestamp: new Date().toISOString(),
        },
      ],
      transaction: {
        format: 'base64_legacy_transaction',
        unsigned_tx_base64: 'c3dhcHR4', // "swaptx" in base64
        recent_blockhash: 'xyz789',
        network: 'devnet',
        execution_type: 'orca_swap_usdc_to_sol',
      },
      swap_execution: {
        provider: 'orca_whirlpools_devnet',
        pair: 'USDC/SOL',
        input_amount: 10,
        slippage_bps: 100,
        quote: null,
      },
    });

    expect(parsed.transaction?.format).toBe('base64_legacy_transaction');
    expect(parsed.swap_execution?.provider).toBe('orca_whirlpools_devnet');
  });

  it('validates transaction payload schema', () => {
    const parsed = TransactionPayloadSchema.parse({
      format: 'base64_versioned_transaction',
      unsigned_tx_base64: 'dGVzdA==',
    });

    expect(parsed.format).toBe('base64_versioned_transaction');
    expect(parsed.unsigned_tx_base64).toBe('dGVzdA==');
  });

  it('validates wallet balances', () => {
    const parsed = GetBalancesResponseSchema.parse({
      balances: [
        {
          symbol: 'SOL',
          mint: 'So11111111111111111111111111111111111111112',
          amount: '1000000000',
          decimals: 9,
          ui_amount: 1,
          usd_value: 145,
        },
      ],
      total_usd: 145,
      change_24h_pct: 2.4,
      updated_at: new Date().toISOString(),
    });

    expect(parsed.balances[0].symbol).toBe('SOL');
  });

  it('validates wallet balances without optional 24h change', () => {
    const parsed = GetBalancesResponseSchema.parse({
      balances: [
        {
          symbol: 'SOL',
          mint: 'So11111111111111111111111111111111111111112',
          amount: '7499840000',
          decimals: 9,
          ui_amount: 7.49984,
          usd_value: 0,
        },
      ],
      total_usd: 0,
      updated_at: '2026-05-10T02:03:57.138Z',
    });

    expect(parsed.change_24h_pct).toBeUndefined();
    expect(parsed.balances[0].ui_amount).toBe(7.49984);
  });

  it('validates function approve response without signed tx submission', () => {
    const parsed = FunctionApproveResponseSchema.parse({
      messages: [
        {
          type: 'text',
          content: 'Transacción preparada. Revisa y firma en tu wallet.',
          timestamp: new Date().toISOString(),
        },
      ],
      proposal_state: {
        state: 'awaiting_signature',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      transaction: {
        format: 'base64_versioned_transaction',
        unsigned_tx_base64: 'AQB0ZXN0',
        recent_blockhash: 'testhash',
        last_valid_block_height: 1234,
        network: 'devnet',
      },
    });

    expect(parsed.proposal_state.state).toBe('awaiting_signature');
    expect(parsed.transaction?.unsigned_tx_base64).toBe('AQB0ZXN0');
    expect(parsed.messages[0].type).toBe('text');
  });

  it('allows conditional buy proposal params and execution envelope', () => {
    const parsedParams = ConditionalBuySolParamsSchema.parse({
      input_token: 'USDC',
      input_amount: 10,
      target_price_usd: 120,
    });

    const parsedProposal = SSEProposalSchema.parse({
      type: 'function_call',
      function: {
        name: 'conditional_buy_sol',
        params: parsedParams,
      },
      display: {
        summary: 'Conditional buy',
        provider: 'simulated',
      },
      risk: {
        score: 35,
        level: 'medium',
      },
      execution: {
        mode: 'phantom_execute_then_optional_backend_proof',
        network: 'devnet',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    expect(parsedProposal.function.name).toBe('conditional_buy_sol');
    expect(parsedProposal.execution?.mode).toBe('phantom_execute_then_optional_backend_proof');
  });

  it('reuses execution enum schema', () => {
    expect(() =>
      FunctionExecutionSchema.parse({
        mode: 'phantom_sign_and_send',
        network: 'mainnet-beta',
        expires_at: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});
