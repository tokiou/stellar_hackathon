import type { TransactionReceipt } from '../../types';

type HeliusTransfer = {
  mint?: string;
  tokenAmount?: number;
  amount?: number;
  fromUserAccount?: string;
  toUserAccount?: string;
};

type HeliusTransaction = {
  timestamp?: number;
  err?: unknown;
  fee?: number;
  type?: string;
  tokenTransfers?: HeliusTransfer[];
  nativeTransfers?: HeliusTransfer[];
};

/**
 * Helius receipt provider with basic receipt fallback when Helius is unavailable.
 * 
 * Calls the BACK service, which proxies Helius without exposing API keys
 * in the browser.
 * 
 * Falls back to basic receipt when:
 * - BACK is not running or Helius is not configured
 * - API request fails (network error, service unavailable)
 * 
 * Basic receipt fallback ensures users always get transaction confirmation with
 * an explorer link, even when enhanced data is unavailable. The isBasic flag
 * indicates when fallback data is used.
 */
export class HeliusReceiptProvider {
  readonly name = 'HeliusReceipt';
  readonly source = 'Helius Enhanced Transactions API';

  private readonly backendUrl: string;
  private readonly network: 'mainnet' | 'devnet';

  constructor() {
    this.backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
    this.network = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet' : 'devnet';
  }

  async fetchReceipt(signature: string): Promise<TransactionReceipt> {
    try {
      // Try to fetch enhanced receipt, fall back to basic if API fails
      return await this.fetchEnhancedReceipt(signature) ?? this.createBasicReceipt(signature);
    } catch {
      // API error - return basic receipt to maintain functionality
      return this.createBasicReceipt(signature);
    }
  }

  private async fetchEnhancedReceipt(signature: string): Promise<TransactionReceipt | null> {
    const base = this.backendUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/helius/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] }),
    });

    if (!response.ok) return null;
    const data = await response.json() as HeliusTransaction[];
    const transaction = data[0];
    return transaction ? this.parseHeliusResponse(transaction, signature) : null;
  }

  private parseHeliusResponse(data: HeliusTransaction, signature: string): TransactionReceipt {
    return {
      signature,
      timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
      status: data.err ? 'failed' : 'success',
      fee: data.fee,
      explorerUrl: this.getExplorerUrl(signature),
      type: data.type || 'Unknown',
      tokenTransfers: data.tokenTransfers?.map((transfer) => ({
        mint: transfer.mint ?? '',
        amount: transfer.tokenAmount ?? transfer.amount ?? 0,
        from: transfer.fromUserAccount ?? '',
        to: transfer.toUserAccount ?? '',
      })),
      nativeTransfers: data.nativeTransfers?.map((transfer) => ({
        amount: transfer.amount ?? 0,
        from: transfer.fromUserAccount ?? '',
        to: transfer.toUserAccount ?? '',
      })),
      isBasic: false,
    };
  }

  private createBasicReceipt(signature: string): TransactionReceipt {
    return {
      signature,
      timestamp: Date.now(),
      status: 'success',
      explorerUrl: this.getExplorerUrl(signature),
      isBasic: true,
    };
  }

  private getExplorerUrl(signature: string): string {
    const cluster = this.network === 'devnet' ? '?cluster=devnet' : '';
    return `https://explorer.solana.com/tx/${signature}${cluster}`;
  }
}
