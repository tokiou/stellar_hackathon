import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import type { ParsedTransferIntent, ParsedSwapIntent, AllowedToken } from './types';
import { TOKEN_REGISTRY } from './tokens';

/**
 * Build a real SOL or SPL token transfer transaction.
 * Returns a Transaction ready to be signed by the wallet adapter.
 */
export async function buildTransferTransaction(
  connection: Connection,
  sender: PublicKey,
  intent: ParsedTransferIntent,
): Promise<Transaction> {
  const recipient = new PublicKey(intent.recipient);
  const transaction = new Transaction();

  if (intent.token === 'SOL') {
    // Native SOL transfer
    const lamports = Math.round(intent.amount * LAMPORTS_PER_SOL);

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports,
      }),
    );
  } else {
    // SPL token transfer
    const tokenInfo = TOKEN_REGISTRY[intent.token];
    const mint = new PublicKey(tokenInfo.mint);
    const rawAmount = Math.round(intent.amount * 10 ** tokenInfo.decimals);

    // Derive ATAs
    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);

    // Check if recipient ATA exists; if not, create it
    let recipientAtaExists = false;
    try {
      await getAccount(connection, recipientAta);
      recipientAtaExists = true;
    } catch {
      recipientAtaExists = false;
    }

    if (!recipientAtaExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          sender,       // payer
          recipientAta, // ATA address
          recipient,    // owner
          mint,         // mint
        ),
      );
    }

    transaction.add(
      createTransferInstruction(
        senderAta,    // source
        recipientAta, // destination
        sender,       // authority
        rawAmount,
      ),
    );
  }

  // Set recent blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = sender;

  return transaction;
}

/**
 * Build a swap transaction.
 * Currently returns null — swaps require Jupiter API integration.
 * When Jupiter is wired in, this function will return a real Transaction.
 */
export async function buildSwapTransaction(
  _connection: Connection,
  _sender: PublicKey,
  _intent: ParsedSwapIntent,
): Promise<null> {
  void _connection;
  void _sender;
  void _intent;
  // Swap transactions require Jupiter API.
  // Return null to indicate demo mode — the UI will handle this gracefully.
  return null;
}

/**
 * Confirm a transaction and wait for finalization.
 * Returns true if confirmed, false if expired/failed.
 */
export async function confirmTransaction(
  connection: Connection,
  signature: string,
  blockhash?: string,
  lastValidBlockHeight?: number,
): Promise<boolean> {
  try {
    if (blockhash && lastValidBlockHeight) {
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      return !result.value.err;
    }
    // Fallback: poll for status
    const result = await connection.getSignatureStatus(signature);
    return result?.value?.confirmationStatus === 'confirmed' ||
           result?.value?.confirmationStatus === 'finalized';
  } catch {
    return false;
  }
}

/**
 * Get the Solana Explorer URL for a transaction.
 */
export function getExplorerUrl(signature: string, cluster: 'devnet' | 'mainnet-beta' = 'devnet'): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

/**
 * Check if the user has sufficient balance for a transfer.
 */
export async function checkBalance(
  connection: Connection,
  owner: PublicKey,
  token: AllowedToken,
  amount: number,
): Promise<{ sufficient: boolean; balance: number }> {
  if (token === 'SOL') {
    const lamports = await connection.getBalance(owner);
    const balance = lamports / LAMPORTS_PER_SOL;
    // Reserve 0.01 SOL for fees
    return { sufficient: balance >= amount + 0.01, balance };
  }

  const tokenInfo = TOKEN_REGISTRY[token];
  const mint = new PublicKey(tokenInfo.mint);

  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    const balance = Number(account.amount) / 10 ** tokenInfo.decimals;
    return { sufficient: balance >= amount, balance };
  } catch {
    // ATA doesn't exist = zero balance
    return { sufficient: false, balance: 0 };
  }
}
