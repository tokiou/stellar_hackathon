import { AddressType, useConnect, useDisconnect, usePhantom } from '@phantom/react-sdk';
import { useWalletBalances } from './useWalletBalances';

function getErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof Error ? error.message : String(error);
}

export function useWallet() {
  const { isConnected, isConnecting, isLoading, addresses, errors } = usePhantom();
  const { connect: sdkConnect, error: connectError } = useConnect();
  const { disconnect: sdkDisconnect, isDisconnecting, error: disconnectError } = useDisconnect();

  const address = addresses.find((item) => item.addressType === AddressType.solana)?.address;
  const balancesQuery = useWalletBalances(address);

  return {
    isConnected: Boolean(isConnected && address),
    isConnecting: isConnecting || isLoading,
    isDisconnecting,
    address,
    connect: () => sdkConnect({ provider: 'google' }),
    disconnect: sdkDisconnect,
    exportPrivateKey: undefined as undefined | (() => Promise<void>),
    walletError: getErrorMessage(errors.connect ?? connectError ?? disconnectError),
    balances: balancesQuery.data,
    isBalancesLoading: balancesQuery.isLoading,
    balancesError: balancesQuery.error,
  };
}
