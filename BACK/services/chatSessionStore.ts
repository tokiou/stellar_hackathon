/**
 * In-memory session store for chat state.
 * Maps sessionId to thread state for HITL resume support.
 * TODO: Replace with Redis/Postgres for production.
 */

export type SolanaNetwork = 'devnet' | 'mainnet-beta';
export type ProposalState =
  | 'awaiting_approval'
  | 'preparing_transaction'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export type SessionFunctionExecution = {
  mode: 'phantom_sign_and_send' | 'phantom_execute_then_optional_backend_proof';
  network: 'devnet' | 'mainnet-beta';
  expires_at: string;
  expected_user_address?: string;
};

export type SessionFunctionMessage = {
  id: string;
  role: 'agent';
  type: 'function_call';
  function: {
    name: 'transfer' | 'conditional_buy_sol' | 'swap_orca_usdc_to_sol' | 'swap' | 'stake';
    params: Record<string, unknown>;
  };
  display: {
    summary: string;
    fee_usd?: number;
    provider?: string;
    slippage_bps?: number;
  };
  risk: {
    score: number;
    level: 'low' | 'medium' | 'critical';
    reasons?: string[];
  };
  execution?: SessionFunctionExecution;
  timestamp: string;
};

export type SessionTextMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  type: 'text';
  content: string;
  timestamp: string;
  execute?: {
    status: 'submitted' | 'confirmed' | 'failed' | 'success';
    tx_hash?: string;
    error?: string;
  };
};

export type SessionAlertMessage = {
  id: string;
  role: 'agent' | 'system';
  type: 'alert';
  severity: 'info' | 'warning' | 'danger';
  content: string;
  timestamp: string;
};

export type SessionHistoryMessage = SessionTextMessage | SessionFunctionMessage | SessionAlertMessage;
export type SessionHistoryMessageInput =
  | (Omit<SessionTextMessage, 'id' | 'timestamp'> & Partial<Pick<SessionTextMessage, 'id' | 'timestamp'>>)
  | (Omit<SessionFunctionMessage, 'id' | 'timestamp'> & Partial<Pick<SessionFunctionMessage, 'id' | 'timestamp'>>)
  | (Omit<SessionAlertMessage, 'id' | 'timestamp'> & Partial<Pick<SessionAlertMessage, 'id' | 'timestamp'>>);

export type PendingProposal = {
  toolName: string;
  toolArgs: Record<string, unknown>;
  toolResult: Record<string, unknown>;
  createdAt: number;
  state: ProposalState;
  proposalType: 'transfer' | 'conditional_buy_sol' | 'swap_orca_usdc_to_sol';
  expiresAt: number;
  expectedUserAddress: string | null;
  network: SolanaNetwork;
  proposalMessage?: SessionFunctionMessage;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  txSignature?: string;
  actionHash?: string;
  actionExpiry?: string;
  policyPda?: string;
  actionApprovalPda?: string;
  walletSafetyAttestationPda?: string;
  actionType?: string;
  actionCreatedAt?: string;
  actionExpiresAt?: string;
};

export type SessionState = {
  sessionId: string;
  threadId: string;
  userAddress: string | null;
  messages: SessionHistoryMessage[];
  pendingProposal: PendingProposal | null;
  createdAt: number;
  updatedAt: number;
};

type ChatSessionRuntime = {
  store: Map<string, SessionState>;
  cleanupHandle: ReturnType<typeof setInterval> | null;
};

const globalChatSessionRuntime = globalThis as typeof globalThis & {
  __compassChatSessionRuntime?: ChatSessionRuntime;
};

const runtime = globalChatSessionRuntime.__compassChatSessionRuntime ??= {
  store: new Map<string, SessionState>(),
  cleanupHandle: null,
};

const store = runtime.store;

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function nowIso() {
  return new Date().toISOString();
}

function ensureMessageId(sessionId: string, role: 'user' | 'agent' | 'system', index: number) {
  return `${sessionId}-${role}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBaseMessage(message: SessionHistoryMessageInput, index: number, sessionId: string) {
  if (message.type === 'function_call') {
    return {
      ...message,
      id: message.id || ensureMessageId(sessionId, message.role, index),
      timestamp: message.timestamp || nowIso(),
    } as SessionFunctionMessage;
  }

  if (message.type === 'alert') {
    return {
      ...message,
      id: message.id || ensureMessageId(sessionId, message.role, index),
      timestamp: message.timestamp || nowIso(),
    } as SessionAlertMessage;
  }

  return {
    ...message,
    id: message.id || ensureMessageId(sessionId, message.role, index),
    timestamp: message.timestamp || nowIso(),
  } as SessionTextMessage;
}

export function appendSessionMessages(
  sessionId: string,
  newMessages: SessionHistoryMessageInput[],
): SessionState | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const prepared = newMessages.map((entry, index) => normalizeBaseMessage(entry, index, sessionId));
  session.messages = [...session.messages, ...prepared];
  session.updatedAt = Date.now();
  store.set(sessionId, session);
  return session;
}

export function appendSessionMessage(
  sessionId: string,
  message: SessionHistoryMessageInput,
): SessionState | null {
  return appendSessionMessages(sessionId, [message]);
}

export function getSession(sessionId: string): SessionState | null {
  const session = store.get(sessionId);
  if (!session) return null;

  // Check TTL
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    store.delete(sessionId);
    return null;
  }

  return session;
}

export function createSession(sessionId: string, threadId: string, userAddress?: string): SessionState {
  const now = Date.now();
  const session: SessionState = {
    sessionId,
    threadId,
    userAddress: userAddress || null,
    messages: [],
    pendingProposal: null,
    createdAt: now,
    updatedAt: now,
  };
  store.set(sessionId, session);
  return session;
}

export function updateSession(
  sessionId: string,
  updates: Partial<Pick<SessionState, 'messages' | 'pendingProposal' | 'threadId' | 'userAddress'>>
): SessionState | null {
  const session = getSession(sessionId);
  if (!session) return null;

  Object.assign(session, updates, { updatedAt: Date.now() });
  store.set(sessionId, session);
  return session;
}

export function clearPendingProposal(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;

  session.pendingProposal = null;
  session.updatedAt = Date.now();
  store.set(sessionId, session);
  return true;
}

export function deleteSession(sessionId: string): boolean {
  return store.delete(sessionId);
}

// Cleanup expired sessions periodically. Keep the interval global-safe for Next dev HMR.
if (!runtime.cleanupHandle) {
  runtime.cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        store.delete(id);
      }
    }
  }, 5 * 60 * 1000);
}
