/**
 * Compatibility re-export for the MCP proxy dispatcher.
 *
 * The canonical implementation now lives in ./proxy/mcpProxyDispatcher.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/mcpProxyDispatcher";
