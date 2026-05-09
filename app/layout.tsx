import type { Metadata } from 'next';
import '@solana/wallet-adapter-react-ui/styles.css';
import '../FRONT/src/index.css';

export const metadata: Metadata = {
  title: 'PromiseKeeper',
  description: 'Verifiable work promises backed by escrow.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
