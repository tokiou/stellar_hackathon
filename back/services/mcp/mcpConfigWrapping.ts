/**
 * Compatibility re-export for the MCP config wrapping helper.
 *
 * The canonical implementation now lives in ./proxy/mcpConfigWrapping.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/mcpConfigWrapping";
