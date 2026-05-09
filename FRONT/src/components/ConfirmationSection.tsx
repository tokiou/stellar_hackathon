import { useState } from 'react';
import type { FC } from 'react';
import { Loader2, CheckCircle, XCircle, RotateCcw, ExternalLink } from 'lucide-react';
import type { RiskAssessment, TransactionStatus } from '@/lib/types';
import { HIGH_RISK_CONFIRMATION_PHRASE } from '@/lib/riskEngine';
import { getExplorerUrl } from '@/lib/transactionBuilder';

interface ConfirmationSectionProps {
  assessment: RiskAssessment;
  txStatus: TransactionStatus;
  txSignature?: string;
  txError?: string;
  isSwapDemo?: boolean;
  onPrepare: () => void;
  onReset: () => void;
}

const ConfirmationSection: FC<ConfirmationSectionProps> = ({
  assessment,
  txStatus,
  txSignature,
  txError,
  isSwapDemo,
  onPrepare,
  onReset,
}) => {
  const [confirmText, setConfirmText] = useState('');

  const isBlocked = assessment.level === 'BLOCKED';
  const needsHighRiskConfirm = assessment.level === 'HIGH';
  const highRiskConfirmed =
    needsHighRiskConfirm && confirmText === HIGH_RISK_CONFIRMATION_PHRASE;
  const canProceed = !isBlocked && (!needsHighRiskConfirm || highRiskConfirmed);

  const isDemoSignature = txSignature?.startsWith('demo_');

  // Success state
  if (txStatus === 'confirmed') {
    return (
      <div className="rounded-lg border border-risk-low/30 bg-risk-low/5 p-4 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle className="h-5 w-5 text-risk-low" />
          <h3 className="text-sm font-semibold text-foreground">
            Transaction {isDemoSignature ? 'simulated' : 'confirmed'}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          {isDemoSignature
            ? 'Swap was simulated in demo mode. No real funds were moved.'
            : 'The transaction was signed, submitted, and confirmed on Solana Devnet.'}
        </p>
        {txSignature && (
          <div className="mb-3 rounded-md bg-surface-2 p-3">
            <p className="text-xs text-muted-foreground mb-1">
              {isDemoSignature ? 'Demo Signature' : 'Transaction Signature'}
            </p>
            {isDemoSignature ? (
              <p className="text-xs font-mono text-muted-foreground break-all">
                {txSignature}
              </p>
            ) : (
              <a
                href={getExplorerUrl(txSignature)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-primary break-all hover:underline inline-flex items-start gap-1"
              >
                {txSignature}
                <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
              </a>
            )}
          </div>
        )}
        {isSwapDemo && isDemoSignature && (
          <p className="text-xs text-risk-medium mb-3">
            Swap execution requires Jupiter API integration. Connect Jupiter to enable real swaps.
          </p>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-3 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          New transaction
        </button>
      </div>
    );
  }

  // Error / cancelled state
  if (txStatus === 'failed' || txStatus === 'cancelled') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-3">
          <XCircle className="h-5 w-5 text-destructive" />
          <h3 className="text-sm font-semibold text-foreground">
            {txStatus === 'cancelled' ? 'Transaction cancelled' : 'Transaction failed'}
          </h3>
        </div>
        {txError && (
          <p className="text-sm text-muted-foreground mb-3">{txError}</p>
        )}
        {!txError && (
          <p className="text-sm text-muted-foreground mb-3">
            The transaction could not be completed. It may have been rejected in the wallet
            or failed on-chain.
          </p>
        )}
        {txSignature && !isDemoSignature && (
          <div className="mb-3 rounded-md bg-surface-2 p-3">
            <p className="text-xs text-muted-foreground mb-1">Transaction (may have failed)</p>
            <a
              href={getExplorerUrl(txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-primary break-all hover:underline inline-flex items-start gap-1"
            >
              {txSignature}
              <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
            </a>
          </div>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-3 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  // Signing / submitted state
  if (txStatus === 'signing' || txStatus === 'submitted') {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {txStatus === 'signing'
                ? 'Waiting for wallet signature'
                : 'Confirming on-chain'}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {txStatus === 'signing'
                ? 'Please review and approve the transaction in your wallet.'
                : 'Transaction submitted. Waiting for network confirmation...'}
            </p>
          </div>
        </div>
        {txSignature && txStatus === 'submitted' && (
          <div className="mt-3 rounded-md bg-surface-2 p-2">
            <a
              href={getExplorerUrl(txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-primary break-all hover:underline inline-flex items-start gap-1"
            >
              View on Explorer
              <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
            </a>
          </div>
        )}
      </div>
    );
  }

  // Blocked state
  if (isBlocked) {
    return (
      <div className="rounded-lg border border-risk-blocked/20 bg-surface-1 p-4 animate-fade-in-up">
        <p className="text-sm text-muted-foreground">
          This transaction is blocked and cannot be prepared. See the safety review
          above for details.
        </p>
        <button
          onClick={onReset}
          className="mt-3 flex items-center gap-2 rounded-md bg-surface-2 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-3 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in-up space-y-4">
      {/* High-risk confirmation input */}
      {needsHighRiskConfirm && (
        <div>
          <label className="text-xs font-medium text-risk-high block mb-2">
            Type the exact phrase to continue:
          </label>
          <div className="mb-2 rounded-md bg-risk-high/5 border border-risk-high/20 p-2">
            <p className="text-xs font-mono text-risk-high/80 select-all">
              {HIGH_RISK_CONFIRMATION_PHRASE}
            </p>
          </div>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type confirmation phrase..."
            className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-risk-high/50 focus:outline-none focus:ring-1 focus:ring-risk-high/30"
          />
          {confirmText.length > 0 && !highRiskConfirmed && (
            <p className="mt-1 text-xs text-risk-high/80">
              Phrase does not match. Type it exactly as shown.
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPrepare}
          disabled={!canProceed}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
            canProceed
              ? assessment.level === 'HIGH'
                ? 'bg-risk-high text-white hover:bg-risk-high/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20'
              : 'bg-surface-2 text-muted-foreground cursor-not-allowed'
          }`}
        >
          {assessment.level === 'HIGH'
            ? 'Sign transaction (high risk)'
            : isSwapDemo
              ? 'Simulate swap (demo)'
              : 'Sign and send transaction'}
        </button>
        <button
          onClick={onReset}
          className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {isSwapDemo
          ? 'Swaps run in demo mode. Transfers are signed and sent via your wallet on Devnet.'
          : 'You will be asked to sign with your own wallet. No funds move until you approve.'}
      </p>
    </div>
  );
};

export default ConfirmationSection;
