#!/usr/bin/env node
// Minimal downstream MCP server for testing the Compass proxy.
// Exposes one tool: echo — returns whatever message you send it.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const downstream = new Server(
  { name: "compass-test-downstream", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

downstream.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo back a message",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to echo" },
        },
        required: ["message"],
      },
    },
    {
      name: "add",
      description: "Add two numbers",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
    },
  ],
}));

downstream.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "echo") {
    return {
      content: [{ type: "text", text: `Echo: ${args?.message ?? ""}` }],
    };
  }
  if (name === "add") {
    const result = Number(args?.a ?? 0) + Number(args?.b ?? 0);
    return {
      content: [{ type: "text", text: String(result) }],
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await downstream.connect(transport);