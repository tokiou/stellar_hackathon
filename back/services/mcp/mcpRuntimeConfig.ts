/**
 * Compatibility re-export for the MCP runtime config parser.
 *
 * The canonical implementation now lives in ./config/mcpRuntimeConfig.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./config/mcpRuntimeConfig";
