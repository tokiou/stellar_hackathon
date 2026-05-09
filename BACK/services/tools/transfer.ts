/**
 * Transfer tool for LangChain/LangGraph agent.
 * Validates and prepares (but does NOT execute) wallet-to-wallet transfers.
 */

import { tool } from '@langchain/core/tools';
import { PublicKey } from '@solana/web3.js';
// Import zod from langchain's bundled version to avoid version conflicts
import { z } from 'zod';

function isValidSolanaAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export type TransferPreparedAction = {
  type: 'TRANSFER';
  fromWallet: string;
  toWallet: string;
  amount: number;
  tokenSymbol: string;
  requiresUserSignature: boolean;
  executedOnChain: boolean;
};

export type TransferToolResult = {
  status: 'prepared' | 'denied';
  reason: string;
  preparedAction: TransferPreparedAction | null;
};

export function prepareTransferResult(args: {
  fromWallet: string;
  toWallet: string;
  amount: number;
  tokenSymbol?: string;
}): TransferToolResult {
  const { fromWallet, toWallet, amount, tokenSymbol } = args;

  if (!isValidSolanaAddress(fromWallet)) {
    return {
      status: 'denied',
      reason: 'INVALID_FROM_WALLET',
      preparedAction: null,
    };
  }

  if (!isValidSolanaAddress(toWallet)) {
    return {
      status: 'denied',
      reason: 'INVALID_TO_WALLET',
      preparedAction: null,
    };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      status: 'denied',
      reason: 'INVALID_AMOUNT',
      preparedAction: null,
    };
  }

  return {
    status: 'prepared',
    reason: 'READY_FOR_USER_APPROVAL',
    preparedAction: {
      type: 'TRANSFER',
      fromWallet,
      toWallet,
      amount,
      tokenSymbol: tokenSymbol || 'SOL',
      requiresUserSignature: true,
      executedOnChain: false,
    },
  };
}

/**
 * LangChain tool definition for transfer_to_wallet.
 * The agent calls this tool when user requests a transfer.
 */
export const transferToWalletTool = tool(
  async (input: { fromWallet: string; toWallet: string; amount: number; tokenSymbol?: string }): Promise<string> => {
    const result = prepareTransferResult(input);
    return JSON.stringify(result);
  },
  {
    name: 'transfer_to_wallet',
    description:
      'Prepares a transfer of SOL or tokens from one Solana wallet to another. ' +
      'Does NOT execute the transfer on-chain. Returns a prepared action that requires user approval.',
    schema: z.object({
      fromWallet: z.string().describe('Source wallet address (Solana public key)'),
      toWallet: z.string().describe('Destination wallet address (Solana public key)'),
      amount: z.number().describe('Amount to transfer (must be positive)'),
      tokenSymbol: z.string().optional().describe('Token symbol (default: SOL)'),
    }) as any, // Cast to avoid version conflicts
  }
);

export const allTools = [transferToWalletTool];
