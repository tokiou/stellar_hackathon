import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postAgentMessage } from '@/lib/api/client';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import type { AgentMessageRequest } from '@/types/api';

export function useAgentMessage() {
  const queryClient = useQueryClient();
  const threshold = useSettingsStore((state) => state.autoConfirmThresholdUsd);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const addAgentMessages = useChatStore((state) => state.addAgentMessages);
  const setStatus = useChatStore((state) => state.setStatus);
  const setPendingProposal = useChatStore((state) => state.setPendingProposal);
  const setProposalUiState = useChatStore((state) => state.setProposalUiState);
  const completeProposal = useChatStore((state) => state.completeProposal);

  const mutation = useMutation({
    mutationFn: postAgentMessage,
    onSuccess: async (response, request) => {
      addAgentMessages(response.messages);

      const executeMessage = response.messages.find((message) => message.type === 'text' && message.execute);
      const functionCall = response.messages.find((message) => message.type === 'function_call');

      if (executeMessage?.type === 'text' && executeMessage.execute) {
        completeProposal(executeMessage.execute.status, executeMessage.execute);
        await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      } else if (functionCall) {
        setStatus('awaiting_approval');
      } else if (request.type !== 'function_approve') {
        setStatus('idle');
      }
    },
    onError: () => {
      setStatus('idle');
    },
  });

  function sendUserMessage(content: string) {
    const blocked = useChatStore.getState().isInputBlocked();
    if (blocked) return;
    addUserMessage(content);
    setStatus('thinking');
    mutation.mutate({ type: 'user_message', content, user_threshold_usd: threshold });
  }

  function approveProposal() {
    const proposal = useChatStore.getState().pendingProposal;
    if (!proposal) return;
    setStatus('executing');
    setProposalUiState('awaiting_execution');
    mutation.mutate({ type: 'function_approve' });
  }

  function rejectProposal() {
    const proposal = useChatStore.getState().pendingProposal;
    if (!proposal) return;
    setProposalUiState('cancelled');
    setPendingProposal(null);
    setStatus('idle');
    mutation.mutate({ type: 'function_reject' } satisfies AgentMessageRequest);
  }

  return {
    sendUserMessage,
    approveProposal,
    rejectProposal,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
