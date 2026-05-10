import { Send } from 'lucide-react';
import type { PendingProposal } from '@/types/chat';
import type { TransferParams } from '@/types/api';
import { truncateAddress } from '@/lib/format';
import { useAgentMessage } from '@/hooks/useAgentMessage';
import { RiskInlineAlert } from './RiskInlineAlert';

export function SendProposalCard({ proposal }: { proposal: PendingProposal }) {
  const params = proposal.function.params as TransferParams;
  const { approveProposal, rejectProposal } = useAgentMessage();

  return (
    <div className="rounded-2xl border border-outline bg-surface p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Send className="h-5 w-5" /></div>
        <div>
          <p className="text-sm font-semibold text-on-surface">Send Proposal</p>
          <p className="text-xs text-on-surface-variant">{proposal.display.summary}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Amount" value={`${params.amount} ${params.token}`} />
        <Detail label="Recipient" value={truncateAddress(params.recipient, 6, 6)} />
        {params.memo ? <Detail label="Memo" value={params.memo} /> : null}
        {proposal.display.fee_usd !== undefined ? <Detail label="Network fee" value={`$${proposal.display.fee_usd.toFixed(2)}`} /> : null}
      </div>
      <RiskInlineAlert risk={proposal.risk} />
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button onClick={rejectProposal} className="rounded-xl border border-outline px-4 py-3 text-sm font-semibold text-on-surface hover:bg-surface-hover">Cancel</button>
        <button onClick={approveProposal} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover">Confirm Send</button>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-outline bg-background px-3 py-2"><p className="text-xs text-on-surface-variant">{label}</p><p className="mt-1 text-sm font-semibold text-on-surface">{value}</p></div>;
}
