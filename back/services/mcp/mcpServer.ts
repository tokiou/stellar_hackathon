import { pathToFileURL } from "node:url";

// Load repo .env before anything else so COMPASS_LLM_* and other
// config is available to the MCP stdio server without dotenv.
import { loadRepoEnv } from "./loadRepoEnv";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import { COMPASS_DECISIONS, TOOL_RISK_CLASSES } from "../executionGatewayContracts";
import { handleMcpToolCall } from "./mcpToolCallRouter";
import type {
	CompassMcpToolListItem,
	CompassMcpToolResult,
} from "./mcpToolContracts";
import { listMcpTools } from "./mcpToolRegistry";
import type {
	CompassMcpServerHandlerDependencies,
	CompassMcpServerHandlers,
} from "./mcpServerContracts";

const COMPASS_MCP_SERVER_INFO = {
	name: "compass-mcp-guard",
	version: "0.0.0",
} as const;

export function createCompassMcpServerHandlers(
	dependencies: CompassMcpServerHandlerDependencies = {},
): CompassMcpServerHandlers {
	const listTools = dependencies.listTools ?? listMcpTools;
	const callTool = dependencies.callTool ?? handleMcpToolCall;

	return {
		async listTools() {
			return { tools: listTools().map(mapCompassToolListItemToMcpTool) };
		},
		async callTool(request) {
			try {
				const result = await callTool({
					toolName: request.params.name,
					arguments: request.params.arguments,
				});
				return mapCompassToolResultToMcpCallResult(result);
			} catch {
				return buildSafeMcpToolError(request.params.name);
			}
		},
	};
}

export function createCompassMcpServer(
	dependencies: CompassMcpServerHandlerDependencies = {},
): Server {
	const server = new Server(COMPASS_MCP_SERVER_INFO, {
		capabilities: { tools: {} },
		instructions:
			"Compass MCP Guard exposes only Compass-controlled Solana tools. Mutating calls pass through guardrails before execution.",
	});
	const handlers = createCompassMcpServerHandlers(dependencies);

	server.setRequestHandler(ListToolsRequestSchema, async () => handlers.listTools());
	server.setRequestHandler(CallToolRequestSchema, async (request) =>
		handlers.callTool(request),
	);

	return server;
}

export function mapCompassToolListItemToMcpTool(
	tool: CompassMcpToolListItem,
): ListToolsResult["tools"][number] {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: {
			type: tool.inputSchema.type,
			properties: { ...tool.inputSchema.properties },
			required: tool.inputSchema.required
				? [...tool.inputSchema.required]
				: undefined,
			additionalProperties: tool.inputSchema.additionalProperties,
		},
		annotations: {
			title: tool.name,
			readOnlyHint: tool.metadata.readOnly,
			destructiveHint: !tool.metadata.readOnly,
			idempotentHint: tool.metadata.readOnly,
			openWorldHint: false,
		},
		_meta: {
			riskClass: tool.metadata.riskClass,
			executionKind: tool.metadata.executionKind,
			readOnly: tool.metadata.readOnly,
		},
	};
}

export function mapCompassToolResultToMcpCallResult(
	result: CompassMcpToolResult,
): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(result),
			},
		],
		structuredContent: result as unknown as Record<string, unknown>,
		isError: false,
	};
}

export async function startCompassMcpStdioServer(): Promise<void> {
	const server = createCompassMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function buildSafeMcpToolError(toolName: string): CallToolResult {
	const result: CompassMcpToolResult = {
		ok: false,
		decision: COMPASS_DECISIONS.DENY,
		toolName,
		riskClass: TOOL_RISK_CLASSES.BLOCKED_UNKNOWN,
		reasonCodes: ["MCP_TOOL_CALL_FAILED"],
		message:
			"Compass failed to process this MCP tool call. The call was denied fail-closed.",
	};

	return {
		...mapCompassToolResultToMcpCallResult(result),
		isError: true,
	};
}

if (isDirectExecution()) {
	loadRepoEnv();
	startCompassMcpStdioServer().catch(() => {
		console.error("Compass MCP stdio server failed to start.");
		process.exit(1);
	});
}

function isDirectExecution(): boolean {
	return Boolean(
		process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
	);
}
