import type {
	CompassDecision,
	ToolRiskClass,
} from "../executionGatewayContracts";
import type { TransferGatewayDecisionMetadata } from "../transferGatewayContracts";

export const MCP_TOOL_NAMES = {
	GET_USDC_SOL_QUOTE: "get_usdc_sol_quote",
	GUARDED_TRANSFER_SOL: "guarded_transfer_sol",
	SIGN_AND_SEND_TRANSACTION: "sign_and_send_transaction",
} as const;

export type CompassMcpToolName =
	(typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

export const MCP_TOOL_EXECUTION_KINDS = {
	READ_PREPARATION: "read_preparation",
	SENSITIVE_EXECUTION: "sensitive_execution",
	SIGNING_DENY_ONLY: "signing_deny_only",
} as const;

export type CompassMcpToolExecutionKind =
	(typeof MCP_TOOL_EXECUTION_KINDS)[keyof typeof MCP_TOOL_EXECUTION_KINDS];

export type CompassMcpJsonSchema = {
	type: "object";
	properties: Readonly<Record<string, object>>;
	required?: readonly string[];
	additionalProperties?: boolean;
};

export type CompassMcpToolListItem = {
	name: CompassMcpToolName;
	description: string;
	inputSchema: CompassMcpJsonSchema;
	metadata: {
		riskClass: ToolRiskClass;
		executionKind: CompassMcpToolExecutionKind;
		readOnly: boolean;
	};
};

export type CompassMcpToolRegistryEntry = CompassMcpToolListItem & {
	classificationToolName: string;
	actionKind: string;
	mutates: boolean;
};

export type CompassMcpToolCallInput = {
	toolName: string;
	arguments?: Record<string, unknown>;
	mutates?: boolean;
};

export type CompassMcpApproval = {
	required: boolean;
	metadata?: TransferGatewayDecisionMetadata;
};

export type CompassMcpToolResult = {
	ok: boolean;
	decision: CompassDecision;
	toolName: string;
	riskClass: ToolRiskClass;
	reasonCodes: string[];
	message: string;
	data?: unknown;
	approval?: CompassMcpApproval;
	auditId?: string;
};
