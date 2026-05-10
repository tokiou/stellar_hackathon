import type { TokenBalance } from '@/types/api';
import { formatTokenAmount, formatUsd } from '@/lib/format';
import { TokenIcon } from './AssetChip';

export function AssetList({ assets = [] }: { assets?: TokenBalance[] }) {
  if (assets.length === 0) {
    return <p className="rounded-2xl border border-outline bg-surface p-4 text-sm text-on-surface-variant">No assets yet.</p>;
  }

  return (
    <div className="rounded-2xl border border-outline bg-surface p-3 shadow-sm">
      <div className="mb-2 px-2 text-sm font-semibold text-on-surface">Assets</div>
      <div className="space-y-1">
        {assets.map((asset) => (
          <div key={asset.mint} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
            <TokenIcon symbol={asset.symbol} iconUrl={asset.icon_url} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-on-surface">{asset.symbol}</p>
              <p className="text-xs text-on-surface-variant tabular-nums">{formatTokenAmount(asset.ui_amount)}</p>
            </div>
            <p className="text-sm font-semibold text-on-surface tabular-nums">{formatUsd(asset.usd_value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
