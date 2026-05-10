import { useEffect, useRef } from 'react';
import { useAgentMessage } from '@/hooks/useAgentMessage';
import { useChatStore } from '@/stores/chatStore';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';

export function ChatContainer() {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const blocked = useChatStore((state) => state.isInputBlocked());
  const { sendUserMessage, isPending } = useAgentMessage();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, status]);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-none bg-transparent md:rounded-3xl md:border md:border-outline md:bg-surface md:shadow-sm">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4 md:px-6 md:py-6">
        <MessageList messages={messages} />
        {status === 'thinking' ? <p className="mt-4 text-sm text-on-surface-variant">Copilot is thinking…</p> : null}
        <div ref={bottomRef} />
      </div>
      <div className="sticky bottom-0 bg-background/90 p-3 backdrop-blur md:rounded-b-3xl md:bg-surface/90 md:p-5">
        <ChatInput disabled={blocked || isPending} isThinking={status === 'thinking'} onSubmit={sendUserMessage} />
      </div>
    </section>
  );
}
