import { AssetAllocationDonut } from '@/components/wallet/AssetAllocationDonut';
import { AssetList } from '@/components/wallet/AssetList';
import { BalanceCard } from '@/components/wallet/BalanceCard';
import { ConnectionStatus } from '@/components/status/ConnectionStatus';
import { useWallet } from '@/hooks/useWallet';
import { useWalletAllocation } from '@/hooks/useWalletAllocation';

export function RightPanel() {
  const wallet = useWallet();
  const allocation = useWalletAllocation(wallet.address);

  return (
    <aside className="space-y-4">
      <BalanceCard data={wallet.balances} isLoading={wallet.isBalancesLoading} isError={Boolean(wallet.balancesError)} />
      <AssetAllocationDonut allocation={allocation.data?.allocation} />
      <AssetList assets={wallet.balances?.balances} />
      <ConnectionStatus />
    </aside>
  );
}
