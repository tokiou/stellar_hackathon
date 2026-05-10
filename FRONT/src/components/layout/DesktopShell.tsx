import { useState } from 'react';
import { AccountCard } from '@/components/sidebar/AccountCard';
import { ChatHistoryList } from '@/components/sidebar/ChatHistoryList';
import { QuickActionsList } from '@/components/sidebar/QuickActionsList';
import { SettingsSheet } from '@/components/sidebar/SettingsSheet';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { AssetList } from '@/components/wallet/AssetList';
import { useWallet } from '@/hooks/useWallet';
import { useTransactionHistory } from '@/hooks/useTransactionHistory';

export function DesktopShell({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wallet = useWallet();
  const history = useTransactionHistory(wallet.address, activeTab === 'History');

  return (
    <div className="min-h-screen bg-background">
      <TopBar activeTab={activeTab} onTabChange={onTabChange} />
      <div className="mx-auto grid max-w-[1440px] grid-cols-[280px_minmax(0,1fr)_320px] gap-6 px-6 py-6">
        <aside className="space-y-4">
          <AccountCard />
          <ChatHistoryList />
          <QuickActionsList onSettings={() => setSettingsOpen(true)} />
        </aside>
        <main className="flex min-h-[calc(100vh-8rem)] min-w-0 flex-col">
          {activeTab === 'Chat' ? <ChatContainer /> : activeTab === 'Assets' ? <AssetList assets={wallet.balances?.balances} /> : activeTab === 'History' ? <HistoryView isLoading={history.isLoading} items={history.data?.transactions ?? []} /> : <ExplorePlaceholder />}
        </main>
        <RightPanel />
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function ExplorePlaceholder() {
  return <div className="rounded-3xl border border-outline bg-surface p-8 text-on-surface-variant shadow-sm">Explore is a phase 2 placeholder.</div>;
}

function HistoryView({ isLoading, items }: { isLoading: boolean; items: Array<{ tx_hash: string; summary: string; timestamp: string; status: string }> }) {
  if (isLoading) return <div className="rounded-3xl border border-outline bg-surface p-8 text-on-surface-variant shadow-sm">Loading history…</div>;
  if (items.length === 0) return <div className="rounded-3xl border border-outline bg-surface p-8 text-on-surface-variant shadow-sm">Sin historial</div>;
  return <div className="space-y-2 rounded-3xl border border-outline bg-surface p-4 shadow-sm">{items.map((item) => <div key={item.tx_hash} className="rounded-xl bg-background p-3"><p className="text-sm font-semibold text-on-surface">{item.summary}</p><p className="text-xs text-on-surface-variant">{new Date(item.timestamp).toLocaleString()} · {item.status}</p></div>)}</div>;
}
