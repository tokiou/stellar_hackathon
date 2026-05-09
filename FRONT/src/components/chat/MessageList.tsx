import type { ChatMessage, PendingProposal } from '@/types/chat';
import { AgentMessage } from './AgentMessage';
import { AlertBanner } from './AlertBanner';
import { TxResultMessage } from './TxResultMessage';
import { UserMessage } from './UserMessage';
import { ProposalCard } from './proposals/ProposalCard';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="space-y-5">
      {messages.map((message) => {
        if (message.role === 'user') return <UserMessage key={message.id} message={message} />;
        if (message.type === 'alert') return <AlertBanner key={message.id} message={message} />;
        if (message.type === 'function_call') return <ProposalCard key={message.id} proposal={{ ...(message as PendingProposal), uiState: 'pending' }} />;
        if (message.type === 'text' && message.execute) return <TxResultMessage key={message.id} message={message} />;
        if (message.type === 'text') return <AgentMessage key={message.id} message={message} />;
        return null;
      })}
    </div>
  );
}
