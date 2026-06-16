/**
 * Compatibility re-export for the MCP stdio server entrypoint.
 *
 * The canonical implementation now lives in ./server/mcpServer.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./server/mcpServer";
