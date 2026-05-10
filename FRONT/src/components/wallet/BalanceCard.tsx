import { ArrowUpRight, RefreshCw } from 'lucide-react';
import type { GetBalancesResponse } from '@/types/api';
import { formatPct, formatUsd } from '@/lib/format';

interface BalanceCardProps {
  data?: GetBalancesResponse;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function BalanceCard({ data, isLoading, isError, onRetry }: BalanceCardProps) {
  if (isLoading) {
    return <div className="h-36 animate-pulse rounded-2xl border border-outline bg-surface" />;
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
        <p className="text-sm text-on-surface-variant">Balance unavailable</p>
        <button onClick={onRetry} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary">
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const total = data?.total_usd ?? 0;
  const change = data?.change_24h_pct ?? 0;
  const positive = change >= 0;

  return (
    <div className="rounded-3xl border border-outline bg-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-on-surface-variant">Total Balance</p>
          <p className="mt-2 text-4xl font-bold tracking-tight text-on-surface tabular-nums md:text-5xl">
            {formatUsd(total)}
          </p>
        </div>
        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${positive ? 'bg-success-bg text-success' : 'bg-error-bg text-error-text'}`}>
          <ArrowUpRight className={`h-4 w-4 ${positive ? '' : 'rotate-90'}`} />
          {formatPct(change)}
        </div>
      </div>
      <p className="mt-4 text-xs text-on-surface-variant">
        Updated {data?.updated_at ? new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
      </p>
    </div>
  );
}
