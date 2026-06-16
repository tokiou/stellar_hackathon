/**
 * LLM Router Contracts - types for the tool classification router.
 *
 * The router classifies downstream MCP tools as transfer, swap, skip, or unknown
 * using an LLM. Contracts live separately from behavior per project convention.
 */

// ---------------------------------------------------------------------------
// Router classification output
// ---------------------------------------------------------------------------

/** Classification categories for downstream tool calls. */
export type LlmRouterClassification = "transfer" | "swap" | "skip" | "unknown";

/** Result of an LLM router classification. */
export type LlmRouterResult = {
  /** The classification assigned by the router. */
  classification: LlmRouterClassification;
  /** Human-readable reasoning for the classification. */
  reasoning: string;
  /** Latency of the LLM call in milliseconds. */
  latencyMs: number;
};

// ---------------------------------------------------------------------------
// Router input
// ---------------------------------------------------------------------------

/** Input to the LLM router for classifying a tool call. */
export type LlmRouterInput = {
  /** The name of the downstream tool. */
  toolName: string;
  /** Optional tool description from the MCP server. */
  toolDescription?: string;
  /** Optional parameters the caller is passing to the tool. */
  toolParams?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Router configuration
// ---------------------------------------------------------------------------

/** Configuration for the LLM router. */
export type LlmRouterConfig = {
  /** When false or absent, the router is disabled and tools fall through to require_approval. */
  enabled: boolean;
  /** Timeout in milliseconds for the LLM call. Default: 3000. */
  timeoutMs: number;
  /** LLM provider key (e.g. "openai"). Falls back to COMPASS_LLM_PROVIDER env. */
  provider?: string;
  /** LLM model name (e.g. "gpt-4o-mini"). Falls back to COMPASS_LLM_MODEL env. */
  model?: string;
};

// ---------------------------------------------------------------------------
// Environment config keys
// ---------------------------------------------------------------------------

export const LLM_ROUTER_ENV = {
  ENABLED: "COMPASS_LLM_ROUTER_ENABLED",
  TIMEOUT_MS: "COMPASS_LLM_ROUTER_TIMEOUT_MS",
} as const;

export const LLM_ROUTER_DEFAULTS = {
  TIMEOUT_MS: 3000,
} as const;
