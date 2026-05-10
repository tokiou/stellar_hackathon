import type { AgentMessage, ExecuteInfo, RiskInfo } from './api';

export type UserChatMessage = {
  id: string;
  role: 'user';
  type: 'text';
  content: string;
  timestamp: string;
};

export type AgentChatMessage = AgentMessage & {
  id: string;
  role: 'agent';
};

export type ChatMessage = UserChatMessage | AgentChatMessage;

export type ProposalUiState =
  | 'pending'
  | 'awaiting_execution'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export type ChatStatus = 'idle' | 'thinking' | 'awaiting_approval' | 'executing';

export type PendingProposal = Extract<AgentChatMessage, { type: 'function_call' }> & {
  uiState: ProposalUiState;
  execute?: ExecuteInfo;
};

export type RiskPresentation = RiskInfo;
