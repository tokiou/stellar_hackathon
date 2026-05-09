import { useQuery } from '@tanstack/react-query';
import { getBalances } from '@/lib/api/client';

export function useWalletBalances(address?: string) {
  return useQuery({
    queryKey: ['wallet', 'balances', address],
    queryFn: () => getBalances(address!),
    enabled: Boolean(address),
    refetchInterval: 30_000,
  });
}
