import { Bot } from 'lucide-react';
import type { AgentChatMessage } from '@/types/chat';

export function AgentMessage({ message }: { message: Extract<AgentChatMessage, { type: 'text' }> }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-agent-bubble text-primary">
        <Bot className="h-4 w-4" />
      </div>
      <div className="max-w-[78%] rounded-3xl rounded-bl-md bg-agent-bubble px-5 py-3 text-[15px] leading-relaxed text-on-agent-bubble">
        {message.content}
      </div>
    </div>
  );
}
