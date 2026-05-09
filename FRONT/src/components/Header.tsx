import type { FC } from 'react';
import { Shield } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

interface HeaderProps {
  showHistory: boolean;
  onToggleHistory: () => void;
}

const Header: FC<HeaderProps> = ({ showHistory, onToggleHistory }) => {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface-0/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold text-foreground leading-tight">
              Intent Wallet Copilot
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Solana
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleHistory}
            className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              showHistory
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            History
          </button>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
};

export default Header;