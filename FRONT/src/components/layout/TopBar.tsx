import { AssetChip } from '@/components/wallet/AssetChip';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { NotificationBell } from '@/components/status/NotificationBell';
import { formatUsd } from '@/lib/format';
import { useWallet } from '@/hooks/useWallet';

const tabs = ['Chat', 'Assets', 'Explore', 'History'];

export function TopBar({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  const { balances } = useWallet();

  return (
    <header className="sticky top-0 z-30 border-b border-outline bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-[1440px] items-center gap-4 px-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-on-surface-variant">Wallet Copilot</p>
          <div className="flex items-center gap-3">
            <p className="text-2xl font-bold tracking-tight text-on-surface tabular-nums">{formatUsd(balances?.total_usd ?? 0)}</p>
            <div className="hidden gap-2 lg:flex">
              {balances?.balances.slice(0, 3).map((asset) => <AssetChip key={asset.mint} asset={asset} />)}
            </div>
          </div>
        </div>

        <nav className="hidden rounded-full border border-outline bg-surface p-1 shadow-sm md:flex">
          {tabs.map((tab) => (
            <button key={tab} onClick={() => onTabChange(tab)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${activeTab === tab ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-hover hover:text-on-surface'}`}>
              {tab}
            </button>
          ))}
        </nav>

        <NotificationBell />
        <div className="hidden sm:block"><ConnectButton /></div>
      </div>
    </header>
  );
}
