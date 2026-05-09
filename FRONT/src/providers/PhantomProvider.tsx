'use client';

import type { ReactNode } from 'react';
import { AddressType, PhantomProvider as SDKPhantomProvider } from '@phantom/react-sdk';

export function PhantomProvider({ children }: { children: ReactNode }) {
  return (
    <SDKPhantomProvider
      config={{
        providers: ['google'],
        addressTypes: [AddressType.solana],
        appId: process.env.NEXT_PUBLIC_PHANTOM_APP_ID,
        embeddedWalletType: 'user-wallet',
      }}
      appName="Wallet Copilot"
      appIcon="/icon.png"
    >
      {children}
    </SDKPhantomProvider>
  );
}
