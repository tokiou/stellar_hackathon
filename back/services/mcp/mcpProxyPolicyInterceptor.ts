/**
 * Compatibility re-export for the MCP proxy policy interceptor.
 *
 * The canonical implementation now lives in ./proxy/mcpProxyPolicyInterceptor.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/mcpProxyPolicyInterceptor";
