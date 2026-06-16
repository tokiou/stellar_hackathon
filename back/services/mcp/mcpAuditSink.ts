/**
 * Compatibility re-export for the MCP audit sink.
 *
 * The canonical implementation now lives in ./proxy/mcpAuditSink.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/mcpAuditSink";
