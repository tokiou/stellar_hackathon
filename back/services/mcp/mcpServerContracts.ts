import type {
	CallToolRequest,
	CallToolResult,
	ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

import type {
	CompassMcpToolCallInput,
	CompassMcpToolListItem,
	CompassMcpToolResult,
} from "./mcpToolContracts";

export type CompassMcpServerListTools = () => CompassMcpToolListItem[];

export type CompassMcpServerCallTool = (
	input: CompassMcpToolCallInput,
) => Promise<CompassMcpToolResult>;

export type CompassMcpServerHandlerDependencies = {
	listTools?: CompassMcpServerListTools;
	callTool?: CompassMcpServerCallTool;
};

export type CompassMcpServerHandlers = {
	listTools: () => Promise<ListToolsResult>;
	callTool: (request: Pick<CallToolRequest, "params">) => Promise<CallToolResult>;
};
