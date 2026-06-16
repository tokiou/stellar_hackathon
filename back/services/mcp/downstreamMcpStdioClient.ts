/**
 * Compatibility re-export for the downstream stdio MCP client.
 *
 * The canonical implementation now lives in ./proxy/downstreamMcpStdioClient.ts.
 * This file remains until all consumers (including tests) migrate to the
 * new path.
 */

export * from "./proxy/downstreamMcpStdioClient";
