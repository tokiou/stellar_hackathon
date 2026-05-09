import type { FC, ReactNode } from 'react';
import { Shield, ArrowRight, Lock, Eye, Wallet } from 'lucide-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const LandingHero: FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4 py-16">
      {/* Badge */}
      <div className="mb-8 flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
        <Shield className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium text-primary">Non-custodial MVP</span>
      </div>

      {/* Title */}
      <h1 className="max-w-2xl text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl leading-tight">
        Intent Wallet Copilot
        <span className="block text-primary mt-1">for Solana</span>
      </h1>

      {/* Subtitle */}
      <p className="mt-5 max-w-lg text-center text-base text-muted-foreground leading-relaxed sm:text-lg">
        Describe the transaction. Review the outcome. Sign with your own wallet.
      </p>

      {/* CTA */}
      <div className="mt-10">
        <WalletMultiButton />
      </div>

      {/* Trust indicators */}
      <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl w-full">
        <TrustCard
          icon={<Lock className="h-4 w-4 text-primary" />}
          title="Non-custodial"
          description="We never touch your private keys or seed phrases."
        />
        <TrustCard
          icon={<Eye className="h-4 w-4 text-primary" />}
          title="Transparent"
          description="Every transaction is previewed before you sign."
        />
        <TrustCard
          icon={<Wallet className="h-4 w-4 text-primary" />}
          title="Your wallet"
          description="You always sign with your own wallet."
        />
      </div>

      {/* Security notices */}
      <div className="mt-12 max-w-lg space-y-2">
        {[
          'We never custody your private keys.',
          'The assistant does not invent token addresses.',
          'Unsupported or ambiguous intents are blocked.',
          'This is an MVP. Use small amounts only.',
        ].map((notice, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <ArrowRight className="h-3 w-3 mt-0.5 text-primary/60 shrink-0" />
            <span>{notice}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface TrustCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

const TrustCard: FC<TrustCardProps> = ({ icon, title, description }) => (
  <div className="rounded-lg border border-border bg-card p-4 text-center">
    <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
      {icon}
    </div>
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
  </div>
);

export default LandingHero;