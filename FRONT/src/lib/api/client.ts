import type {
  AgentMessageRequest,
  AgentMessageResponse,
  ApiError,
  GetAllocationResponse,
  GetBalancesResponse,
  GetNetworkStatusResponse,
  GetPricesResponse,
  GetTransactionsQuery,
  GetTransactionsResponse,
} from '@/types/api';
import {
  AgentMessageResponseSchema,
  ApiErrorSchema,
  GetAllocationResponseSchema,
  GetBalancesResponseSchema,
  GetNetworkStatusResponseSchema,
  GetPricesResponseSchema,
  GetTransactionsResponseSchema,
} from './schemas';

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(error: ApiError['error'], status: number) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError(
      { code: 'invalid_json', message: 'The server returned invalid JSON.' },
      response.status,
    );
  }
}

function throwIfApiError(data: unknown, status: number): void {
  const parsed = ApiErrorSchema.safeParse(data);
  if (parsed.success) {
    throw new ApiClientError(parsed.data.error as ApiError['error'], status);
  }
}

async function getJson<T>(url: string, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await parseJson(response);
  throwIfApiError(data, response.status);
  if (!response.ok) {
    throw new ApiClientError(
      { code: 'http_error', message: `Request failed with status ${response.status}` },
      response.status,
    );
  }
  return schema.parse(data);
}

async function postJson<T>(url: string, body: unknown, schema: { parse: (value: unknown) => T }): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await parseJson(response);
  throwIfApiError(data, response.status);
  if (!response.ok) {
    throw new ApiClientError(
      { code: 'http_error', message: `Request failed with status ${response.status}` },
      response.status,
    );
  }
  return schema.parse(data);
}

export function postAgentMessage(body: AgentMessageRequest): Promise<AgentMessageResponse> {
  return postJson('/api/agent/message', body, AgentMessageResponseSchema) as Promise<AgentMessageResponse>;
}

export function getBalances(address: string): Promise<GetBalancesResponse> {
  return getJson(`/api/wallet/balances?address=${encodeURIComponent(address)}`, GetBalancesResponseSchema) as Promise<GetBalancesResponse>;
}

export function getAllocation(address: string): Promise<GetAllocationResponse> {
  return getJson(`/api/wallet/allocation?address=${encodeURIComponent(address)}`, GetAllocationResponseSchema) as Promise<GetAllocationResponse>;
}

export function getTransactions(query: GetTransactionsQuery): Promise<GetTransactionsResponse> {
  const params = new URLSearchParams({ address: query.address });
  if (query.limit) params.set('limit', String(query.limit));
  if (query.before) params.set('before', query.before);
  return getJson(`/api/wallet/transactions?${params.toString()}`, GetTransactionsResponseSchema) as Promise<GetTransactionsResponse>;
}

export function getNetworkStatus(): Promise<GetNetworkStatusResponse> {
  return getJson('/api/network/status', GetNetworkStatusResponseSchema) as Promise<GetNetworkStatusResponse>;
}

export function getPrices(symbols: string[]): Promise<GetPricesResponse> {
  return getJson(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`, GetPricesResponseSchema) as Promise<GetPricesResponse>;
}
