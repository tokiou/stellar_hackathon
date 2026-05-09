import type { FC } from 'react';
import { ArrowRight, Send, AlertCircle } from 'lucide-react';
import type { ParsedIntent, ParseError } from '@/lib/types';

interface ParsedIntentPanelProps {
  intent?: ParsedIntent;
  error?: ParseError;
}

const ParsedIntentPanel: FC<ParsedIntentPanelProps> = ({ intent, error }) => {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 animate-fade-in-up">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-destructive">Intent could not be parsed</h3>
            <p className="mt-1 text-sm text-foreground/80">{error.message}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono bg-surface-2 px-2 py-0.5 rounded">
                {error.type}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!intent) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        <h3 className="text-sm font-semibold text-foreground">Parsed Intent</h3>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
          intent.confidence === 'high'
            ? 'bg-risk-low/10 text-risk-low'
            : intent.confidence === 'medium'
            ? 'bg-risk-medium/10 text-risk-medium'
            : 'bg-risk-high/10 text-risk-high'
        }`}>
          {intent.confidence} confidence
        </span>
      </div>

      {/* Original text */}
      <div className="mb-3 rounded-md bg-surface-2 p-3">
        <p className="text-xs text-muted-foreground mb-1">You said:</p>
        <p className="text-sm text-foreground font-mono">"{intent.originalText}"</p>
      </div>

      {/* Parsed details */}
      {intent.action === 'swap' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary uppercase">
              Swap
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="rounded-md bg-surface-2 px-3 py-2">
              <span className="text-muted-foreground text-xs">From</span>
              <p className="font-semibold text-foreground">
                {intent.amount} {intent.inputToken}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="rounded-md bg-surface-2 px-3 py-2">
              <span className="text-muted-foreground text-xs">To</span>
              <p className="font-semibold text-foreground">
                {intent.outputToken}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Slippage tolerance: {intent.slippage}%
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary uppercase">
              Transfer
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="rounded-md bg-surface-2 px-3 py-2">
              <span className="text-muted-foreground text-xs">Amount</span>
              <p className="font-semibold text-foreground">
                {intent.amount} {intent.token}
              </p>
            </div>
            <Send className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="rounded-md bg-surface-2 px-3 py-2 min-w-0">
              <span className="text-muted-foreground text-xs">Recipient</span>
              <p className="font-mono text-foreground text-xs truncate">
                {intent.recipient}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParsedIntentPanel;