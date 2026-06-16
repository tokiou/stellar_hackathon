/**
 * Compatibility re-export for the MCP proxy audit helper.
 *
 * The canonical implementation now lives in ./proxy/mcpProxyAudit.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/mcpProxyAudit";
