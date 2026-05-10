import { create } from 'zustand';
import type { AgentMessage, ExecuteInfo } from '@/types/api';
import type { AgentChatMessage, ChatMessage, ChatStatus, PendingProposal, ProposalUiState, UserChatMessage } from '@/types/chat';

function id(prefix = 'msg') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toAgentChatMessage(message: AgentMessage): AgentChatMessage {
  return { ...message, id: id('agent'), role: 'agent' } as AgentChatMessage;
}

interface ChatStore {
  messages: ChatMessage[];
  pendingProposal: PendingProposal | null;
  proposalUiState: ProposalUiState | null;
  status: ChatStatus;
  isInputBlocked: () => boolean;
  addUserMessage: (content: string) => void;
  addAgentMessages: (messages: AgentMessage[]) => void;
  setPendingProposal: (proposal: PendingProposal | null) => void;
  setProposalUiState: (state: ProposalUiState | null) => void;
  completeProposal: (status: ExecuteInfo['status'], execute?: ExecuteInfo) => void;
  setStatus: (status: ChatStatus) => void;
  clearChat: () => void;
}

const welcomeMessage: AgentChatMessage = {
  id: 'welcome',
  role: 'agent',
  type: 'text',
  content: 'Hi, I’m your Wallet Copilot. Tell me what you want to do on Solana — I’ll review it and ask for confirmation when needed.',
  timestamp: new Date().toISOString(),
};

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [welcomeMessage],
  pendingProposal: null,
  proposalUiState: null,
  status: 'idle',

  isInputBlocked: () => get().status !== 'idle' || get().pendingProposal !== null,

  addUserMessage: (content) => {
    const message: UserChatMessage = {
      id: id('user'),
      role: 'user',
      type: 'text',
      content,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({ messages: [...state.messages, message] }));
  },

  addAgentMessages: (agentMessages) => {
    const chatMessages = agentMessages.map(toAgentChatMessage);
    const functionCall = chatMessages.find((message) => message.type === 'function_call') as PendingProposal | undefined;

    set((state) => ({
      messages: [...state.messages, ...chatMessages],
      pendingProposal: functionCall ? { ...functionCall, uiState: 'pending' } : state.pendingProposal,
      proposalUiState: functionCall ? 'pending' : state.proposalUiState,
      status: functionCall ? 'awaiting_approval' : state.status,
    }));
  },

  setPendingProposal: (proposal) => set({ pendingProposal: proposal }),
  setProposalUiState: (proposalUiState) => set({ proposalUiState }),

  completeProposal: (status, execute) => {
    void execute;
    set({
      pendingProposal: null,
      proposalUiState: status === 'success' ? 'confirmed' : 'failed',
      status: 'idle',
    });
  },

  setStatus: (status) => set({ status }),

  clearChat: () => set({ messages: [welcomeMessage], pendingProposal: null, proposalUiState: null, status: 'idle' }),
}));
