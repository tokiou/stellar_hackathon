/**
 * Backend Chat Service using Azure Responses API with SSE streaming.
 * Implements agentic flow with tools for Solana transfers.
 */

import { getEnv, jsonResponse } from './upstream';
import {
  getSession,
  createSession,
  updateSession,
  clearPendingProposal,
} from './chatSessionStore';
import { prepareTransferResult, type TransferToolResult } from './tools/transfer';
import {
  callAzureResponsesStream,
  callAzureResponses,
  parseResponsesStream,
  type ResponsesToolDefinition,
  type ResponsesApiResponse,
} from './azureResponsesClient';

// ============================================================================
// Types
// ============================================================================

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

type InputMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
};

type ChatRequestBody = {
  sessionId?: string;
  threadId?: string;
  messages?: InputMessage[];
  resume?: {
    approved: boolean;
    reason?: string;
  };
};

// ============================================================================
// Tool Definitions
// ============================================================================

const TRANSFER_TOOL: ResponsesToolDefinition = {
  type: 'function',
  name: 'transfer_to_wallet',
  description:
    'Prepares a transfer of SOL or tokens from one Solana wallet to another. ' +
    'Does NOT execute the transfer on-chain. Returns a prepared action that requires user approval. ' +
    'Use this when the user wants to send/transfer SOL or tokens to another wallet address.',
  parameters: {
    type: 'object',
    properties: {
      fromWallet: {
        type: 'string',
        description: 'Source wallet address (Solana public key)',
      },
      toWallet: {
        type: 'string',
        description: 'Destination wallet address (Solana public key)',
      },
      amount: {
        type: 'number',
        description: 'Amount to transfer (must be positive)',
      },
      tokenSymbol: {
        type: 'string',
        description: 'Token symbol (default: SOL)',
      },
    },
    required: ['fromWallet', 'toWallet', 'amount'],
  },
};

const ALL_TOOLS = [TRANSFER_TOOL];

// ============================================================================
// SSE Helpers
// ============================================================================

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSSEStream(): {
  stream: ReadableStream<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
} {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      streamController.enqueue(chunk);
    },
    close() {
      streamController.close();
    },
    abort(err) {
      streamController.error(err);
    },
  });

  const writer = writable.getWriter();

  return { stream, writer, encoder };
}

async function writeSSE(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown
) {
  await writer.write(encoder.encode(sseEvent(event, data)));
}

// ============================================================================
// Message Normalization
// ============================================================================

export function normalizeMessages(input: unknown): InputMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;

  const normalized: InputMessage[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const msg = item as Record<string, unknown>;
    const role = msg.role;
    const content = msg.content;

    if (
      (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') ||
      typeof content !== 'string'
    ) {
      return null;
    }

    normalized.push({
      role,
      content,
      ...(typeof msg.name === 'string' ? { name: msg.name } : {}),
      ...(typeof msg.tool_call_id === 'string' ? { tool_call_id: msg.tool_call_id } : {}),
    });
  }

  return normalized;
}

/**
 * Convert messages array to a single input string for Responses API.
 */
function messagesToInput(messages: InputMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'system') return `[Sistema]: ${m.content}`;
      if (m.role === 'assistant') return `[Asistente]: ${m.content}`;
      if (m.role === 'tool') return `[Resultado de herramienta ${m.name || ''}]: ${m.content}`;
      return `[Usuario]: ${m.content}`;
    })
    .join('\n\n');
}

// For test compatibility
export function inputToLangChainMessages(messages: InputMessage[]) {
  // Stub for backward compatibility with tests
  return messages.map((m) => ({
    _getType: () => (m.role === 'user' ? 'human' : m.role === 'assistant' ? 'ai' : m.role),
    content: m.content,
  }));
}

// ============================================================================
// Tool Execution
// ============================================================================

function executeTransferTool(args: {
  fromWallet: string;
  toWallet: string;
  amount: number;
  tokenSymbol?: string;
}): TransferToolResult {
  return prepareTransferResult(args);
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function proxyAgenticChat(body: unknown): Promise<Response> {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'OPENAI_API_KEY_NOT_CONFIGURED' }, { status: 503 });
  }

  const parsed = body as ChatRequestBody;

  // Validate sessionId
  if (!parsed.sessionId || typeof parsed.sessionId !== 'string' || parsed.sessionId.trim() === '') {
    return jsonResponse({ error: 'MISSING_SESSION_ID' }, { status: 400 });
  }

  const sessionId = parsed.sessionId.trim();
  const threadId = parsed.threadId || sessionId;

  // Handle resume flow
  if (parsed.resume) {
    if (typeof parsed.resume.approved !== 'boolean') {
      return jsonResponse({ error: 'INVALID_RESUME_PAYLOAD' }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session || !session.pendingProposal) {
      return jsonResponse({ error: 'NO_PENDING_PROPOSAL' }, { status: 400 });
    }

    return handleResumeFlow(sessionId, threadId, parsed.resume);
  }

  // Validate messages for normal flow
  const messages = normalizeMessages(parsed.messages);
  if (!messages) {
    return jsonResponse({ error: 'MISSING_MESSAGES' }, { status: 400 });
  }

  return handleChatFlow(sessionId, threadId, messages);
}

async function handleChatFlow(
  sessionId: string,
  threadId: string,
  inputMessages: InputMessage[]
): Promise<Response> {
  const { stream, writer, encoder } = createSSEStream();

  (async () => {
    try {
      // Get or create session
      let session = getSession(sessionId);
      if (!session) {
        session = createSession(sessionId, threadId);
      }

      // Build conversation input
      const systemInstruction =
        'Eres un asistente de guardrails para Solana. ' +
        'Puedes ayudar a preparar transferencias de tokens entre wallets. ' +
        'Cuando el usuario pida transferir SOL o tokens, usa la herramienta transfer_to_wallet. ' +
        'NUNCA digas que ejecutaste una transferencia on-chain. Solo puedes preparar la acción y pedir aprobación del usuario.';

      const conversationInput = messagesToInput(inputMessages);

      // First call: check if model wants to use tools
      const initialResponse = await callAzureResponses({
        input: conversationInput,
        instructions: systemInstruction,
        tools: ALL_TOOLS,
        maxOutputTokens: 4096,
      });

      // Check for tool calls in output
      const toolCall = initialResponse.output?.find((o) => o.type === 'function_call');

      if (toolCall && toolCall.name === 'transfer_to_wallet') {
        // Parse tool arguments
        let toolArgs: { fromWallet: string; toWallet: string; amount: number; tokenSymbol?: string };
        try {
          toolArgs = JSON.parse(toolCall.arguments || '{}');
        } catch {
          await writeSSE(writer, encoder, 'error', {
            error: 'INVALID_TOOL_ARGS',
            message: 'Could not parse tool arguments',
          });
          await writeSSE(writer, encoder, 'done', { sessionId, threadId });
          await writer.close();
          return;
        }

        // Execute tool
        const toolResult = executeTransferTool(toolArgs);

        if (toolResult.status === 'prepared') {
          // Store pending proposal for HITL
          updateSession(sessionId, {
            pendingProposal: {
              toolName: 'transfer_to_wallet',
              toolArgs,
              toolResult,
              createdAt: Date.now(),
            },
            threadId,
          });

          // Send proposal event
          await writeSSE(writer, encoder, 'proposal', {
            type: 'approval_required',
            proposal: toolResult.preparedAction,
            message: 'Esta transferencia requiere tu aprobación. ¿Deseas continuar?',
            sessionId,
            threadId,
          });

          await writeSSE(writer, encoder, 'done', { sessionId, threadId, awaitingApproval: true });
          await writer.close();
          return;
        } else {
          // Tool denied the action, stream explanation
          const denialInput =
            conversationInput +
            `\n\n[Resultado de herramienta transfer_to_wallet]: La transferencia fue rechazada. Razón: ${toolResult.reason}`;

          const denialStream = await callAzureResponsesStream({
            input: denialInput,
            instructions: systemInstruction,
            maxOutputTokens: 1024,
          });

          await streamResponseToSSE(denialStream, writer, encoder);
          await writeSSE(writer, encoder, 'done', { sessionId, threadId });
          await writer.close();
          return;
        }
      }

      // No tool call - stream the response directly
      const responseStream = await callAzureResponsesStream({
        input: conversationInput,
        instructions: systemInstruction,
        tools: ALL_TOOLS,
        maxOutputTokens: 4096,
      });

      await streamResponseToSSE(responseStream, writer, encoder);
      await writeSSE(writer, encoder, 'done', { sessionId, threadId });
    } catch (err) {
      console.error('[chat] Stream error:', err);
      await writeSSE(writer, encoder, 'error', {
        error: 'STREAM_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  })();

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

async function streamResponseToSSE(
  responseStream: ReadableStream<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
) {
  for await (const event of parseResponsesStream(responseStream)) {
    // Handle different event types from Responses API
    if (event.type === 'response.output_text.delta') {
      const delta = event.delta || '';
      if (delta) {
        await writeSSE(writer, encoder, 'token', { content: delta });
      }
    } else if (event.type === 'response.content_part.delta') {
      const delta = event.delta?.text || '';
      if (delta) {
        await writeSSE(writer, encoder, 'token', { content: delta });
      }
    } else if (event.type === 'response.output_item.added') {
      // New output item, could be message or function_call
      if (event.item?.type === 'message' && event.item?.content) {
        for (const part of event.item.content) {
          if (part.text) {
            await writeSSE(writer, encoder, 'token', { content: part.text });
          }
        }
      }
    } else if (event.type === 'response.completed') {
      // Final response
      const output = event.response?.output;
      if (Array.isArray(output)) {
        for (const item of output) {
          if (item.type === 'message' && item.content) {
            for (const part of item.content) {
              if (part.text && part.type === 'output_text') {
                await writeSSE(writer, encoder, 'token', { content: part.text });
              }
            }
          }
        }
      }
    }
  }
}

async function handleResumeFlow(
  sessionId: string,
  threadId: string,
  resume: { approved: boolean; reason?: string }
): Promise<Response> {
  const { stream, writer, encoder } = createSSEStream();

  (async () => {
    try {
      const session = getSession(sessionId);
      if (!session?.pendingProposal) {
        await writeSSE(writer, encoder, 'error', {
          error: 'NO_PENDING_PROPOSAL',
          message: 'No hay propuesta pendiente para esta sesión',
        });
        await writer.close();
        return;
      }

      const { toolResult } = session.pendingProposal;
      clearPendingProposal(sessionId);

      const systemInstruction =
        'Eres un asistente de guardrails para Solana. Responde al usuario sobre el resultado de su decisión.';

      let responseInput: string;

      if (resume.approved) {
        responseInput =
          `El usuario APROBÓ la transferencia. Detalles de la acción preparada: ${JSON.stringify(toolResult)}. ` +
          'Confirma al usuario que la transferencia está lista para ser firmada con su wallet. ' +
          'Recuerda que NO se ejecutó on-chain todavía, solo está preparada.';
      } else {
        responseInput =
          `El usuario RECHAZÓ la transferencia. ${resume.reason ? `Razón: ${resume.reason}` : ''} ` +
          'Confirma al usuario que la transferencia fue cancelada y pregunta si necesita algo más.';
      }

      const responseStream = await callAzureResponsesStream({
        input: responseInput,
        instructions: systemInstruction,
        maxOutputTokens: 1024,
      });

      await streamResponseToSSE(responseStream, writer, encoder);
      await writeSSE(writer, encoder, 'done', { sessionId, threadId, resumed: true, approved: resume.approved });
    } catch (err) {
      console.error('[chat] Resume error:', err);
      await writeSSE(writer, encoder, 'error', {
        error: 'RESUME_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed
      }
    }
  })();

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
