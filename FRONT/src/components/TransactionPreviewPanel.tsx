import type { FC } from 'react';
import { ArrowDownUp, Send, Info } from 'lucide-react';
import type { TransactionPreview } from '@/lib/types';
import { formatTokenAmount } from '@/lib/quoteProvider';
import { getDemoUsdValue } from '@/lib/tokens';

interface TransactionPreviewPanelProps {
  preview: TransactionPreview;
}

const TransactionPreviewPanel: FC<TransactionPreviewPanelProps> = ({ preview }) => {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-4">
        {preview.type === 'swap' ? (
          <ArrowDownUp className="h-4 w-4 text-primary" />
        ) : (
          <Send className="h-4 w-4 text-primary" />
        )}
        <h3 className="text-sm font-semibold text-foreground">Transaction Preview</h3>
      </div>

      {preview.type === 'swap' ? (
        <SwapPreviewContent preview={preview} />
      ) : (
        <TransferPreviewContent preview={preview} />
      )}

      {/* Warning */}
      <div className="mt-4 flex items-start gap-2 rounded-md bg-risk-medium/5 border border-risk-medium/20 p-3">
        <Info className="h-4 w-4 text-risk-medium shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/80">
          Review all details carefully before signing. You are responsible for confirming the accuracy of this transaction.
        </p>
      </div>
    </div>
  );
};

const SwapPreviewContent: FC<{ preview: TransactionPreview & { type: 'swap' } }> = ({ preview }) => {
  const { quote } = preview;
  const inputUsd = getDemoUsdValue(quote.inputToken, quote.inputAmount);
  const outputUsd = getDemoUsdValue(quote.outputToken, quote.estimatedOutput);

  return (
    <div className="space-y-3">
      {/* Input / Output */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-md bg-surface-2 p-3">
          <p className="text-xs text-muted-foreground mb-1">You send</p>
          <p className="text-lg font-semibold text-foreground">
            {formatTokenAmount(quote.inputAmount, quote.inputToken)} {quote.inputToken}
          </p>
          <p className="text-xs text-muted-foreground">~${inputUsd.toFixed(2)}</p>
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <p className="text-xs text-muted-foreground mb-1">You receive (estimated)</p>
          <p className="text-lg font-semibold text-primary">
            {formatTokenAmount(quote.estimatedOutput, quote.outputToken)} {quote.outputToken}
          </p>
          <p className="text-xs text-muted-foreground">~${outputUsd.toFixed(2)}</p>
        </div>
      </div>

      {/* Details rows */}
      <div className="space-y-1.5 text-sm">
        <DetailRow label="Exchange rate" value={`1 ${quote.inputToken} = ${quote.exchangeRate} ${quote.outputToken}`} />
        <DetailRow label="Slippage tolerance" value={`${quote.slippage}%`} />
        <DetailRow
          label="Price impact"
          value={`${quote.priceImpact}%`}
          valueClass={
            quote.priceImpact > 10 ? 'text-risk-high' :
            quote.priceImpact > 3 ? 'text-risk-medium' :
            'text-risk-low'
          }
        />
        <DetailRow label="Route" value={quote.route} />
        <DetailRow label="Provider" value={quote.provider} />
        <DetailRow label="Network fee (est.)" value={`~${quote.networkFeeEstimate} SOL`} />
      </div>
    </div>
  );
};

const TransferPreviewContent: FC<{ preview: TransactionPreview & { type: 'transfer' } }> = ({ preview }) => {
  const { preview: tp } = preview;
  const usd = getDemoUsdValue(tp.token, tp.amount);

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground mb-1">Amount</p>
        <p className="text-lg font-semibold text-foreground">
          {formatTokenAmount(tp.amount, tp.token)} {tp.token}
        </p>
        <p className="text-xs text-muted-foreground">~${usd.toFixed(2)}</p>
      </div>

      <div className="space-y-1.5 text-sm">
        <DetailRow label="From" value={truncate(tp.sender)} mono />
        <DetailRow label="To" value={truncate(tp.recipient)} mono />
        <DetailRow label="Token" value={tp.token} />
        <DetailRow label="Network fee (est.)" value={`~${tp.networkFeeEstimate} SOL`} />
      </div>
    </div>
  );
};

interface DetailRowProps {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
}

const DetailRow: FC<DetailRowProps> = ({ label, value, valueClass, mono }) => (
  <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs font-medium ${mono ? 'font-mono' : ''} ${valueClass || 'text-foreground'}`}>
      {value}
    </span>
  </div>
);

function truncate(addr: string): string {
  if (addr.length > 16) {
    return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
  }
  return addr;
}

export default TransactionPreviewPanel;