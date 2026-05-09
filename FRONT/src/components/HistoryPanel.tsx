import { useState, useEffect } from 'react';
import type { FC } from 'react';
import { Clock, ArrowDownUp, Send, Trash2, ChevronRight } from 'lucide-react';
import type { HistoryEntry, RiskLevel } from '@/lib/types';
import { loadHistory, clearHistory } from '@/lib/history';

interface HistoryPanelProps {
  refreshKey: number;
}

const HistoryPanel: FC<HistoryPanelProps> = ({ refreshKey }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, [refreshKey]);

  const handleClear = () => {
    clearHistory();
    setHistory([]);
  };

  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No transaction history yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Your recent intents will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Recent Activity
        </h2>
        <button
          onClick={handleClear}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      <div className="space-y-2">
        {history.map(entry => (
          <HistoryItem key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
};

const HistoryItem: FC<{ entry: HistoryEntry }> = ({ entry }) => {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-2/50 transition-colors"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 shrink-0">
          {entry.action === 'swap' ? (
            <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Send className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {entry.originalText}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <RiskBadge level={entry.riskLevel} />
            <StatusBadge status={entry.status} />
            <span className="text-xs text-muted-foreground/60">
              {dateStr} {timeStr}
            </span>
          </div>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 bg-surface-1/50 space-y-1.5">
          <DetailLine label="Action" value={entry.action} />
          <DetailLine label="Details" value={entry.details} />
          {entry.txSignature && (
            <div>
              <span className="text-xs text-muted-foreground">Signature: </span>
              <span className="text-xs font-mono text-primary break-all">
                {entry.txSignature}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const RiskBadge: FC<{ level: RiskLevel }> = ({ level }) => {
  const cls = {
    LOW: 'bg-risk-low/10 text-risk-low',
    MEDIUM: 'bg-risk-medium/10 text-risk-medium',
    HIGH: 'bg-risk-high/10 text-risk-high',
    BLOCKED: 'bg-risk-blocked/10 text-risk-blocked',
  }[level];

  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${cls}`}>
      {level}
    </span>
  );
};

const StatusBadge: FC<{ status: string }> = ({ status }) => {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className="text-[10px] text-muted-foreground/80 font-medium">
      {label}
    </span>
  );
};

const DetailLine: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start gap-2">
    <span className="text-xs text-muted-foreground shrink-0 w-14">{label}:</span>
    <span className="text-xs text-foreground/80">{value}</span>
  </div>
);

export default HistoryPanel;