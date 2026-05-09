import { useQuery } from '@tanstack/react-query';
import { getTransactions } from '@/lib/api/client';

export function useTransactionHistory(address?: string, enabled = false) {
  return useQuery({
    queryKey: ['wallet', 'transactions', address],
    queryFn: () => getTransactions({ address: address!, limit: 20 }),
    enabled: Boolean(address) && enabled,
  });
}
