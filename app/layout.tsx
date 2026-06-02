import type { Metadata } from 'next';
import '../front/src/styles/globals.css';

export const metadata: Metadata = {
  title: 'Compass',
  description: 'AI wallet guardrails for safer Solana actions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
