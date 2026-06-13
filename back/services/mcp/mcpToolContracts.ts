import type { ConditionalGatewayDecisionMetadata } from "../conditionalGatewayContracts";
import type {
	CompassDecision,
	ToolRiskClass,
} from "../executionGatewayContracts";
import type { SwapGatewayDecisionMetadata } from "../swapGatewayContracts";
import type { TransferGatewayDecisionMetadata } from "../transferGatewayContracts";
import type { OnchainActionApprovalProof } from "../onchainApproval";

export const MCP_TOOL_NAMES = {
	GET_USDC_SOL_QUOTE: "get_usdc_sol_quote",
	QUOTE_SWAP: "quote_swap",
	SIMULATE_CONDITIONAL_BUY_ORACLE_CHECK:
		"simulate_conditional_buy_oracle_check",
	// Public E2E write tools (Wave 10)
	COMPASS_TRANSFER: "compass_transfer",
	COMPASS_SWAP: "compass_swap",
	// Internal-only (not in public listMcpTools)
	GUARDED_TRANSFER_SOL: "guarded_transfer_sol",
	GUARDED_SWAP_SOL_USDC: "guarded_swap_sol_usdc",
	EXECUTE_APPROVED_ACTION: "execute_approved_action",
	SIGN_AND_SEND_TRANSACTION: "sign_and_send_transaction",
	CREATE_CONDITIONAL_BUY_SOL: "create_conditional_buy_sol",
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

export type ExecuteApprovedActionTransactionPayload = {
	encoding: "base64";
	actionHash: string;
	unsignedVersionedTransaction: string;
};

export type ExecuteApprovedActionInput = {
	candidateId: string;
	network?: "devnet" | "testnet" | "mainnet-beta";
	approvalProof?: OnchainActionApprovalProof;
	transactionPayload: ExecuteApprovedActionTransactionPayload;
};

export type CompassMcpApproval = {
	required: boolean;
	metadata?:
		| TransferGatewayDecisionMetadata
		| SwapGatewayDecisionMetadata
		| ConditionalGatewayDecisionMetadata;
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

// --- Wave 10: E2E MCP input types ---

export type McpSupportedNetwork = "devnet" | "testnet" | "mainnet-beta";

/**
 * Input type for compass_transfer tool.
 * Mirrors the transfer gateway fields plus userConfirmedRisk.
 */
export type CompassTransferInput = {
	network?: McpSupportedNetwork;
	actorWallet?: string;
	amountSol: number;
	recipientAddress: string;
	recipientKnown?: boolean;
	walletSafety?: unknown;
	userConfirmedRisk?: boolean;
};

/**
 * Input type for compass_swap tool.
 * Mirrors the swap gateway fields plus userConfirmedRisk.
 */
export type CompassSwapInput = {
	network?: McpSupportedNetwork;
	actorWallet?: string;
	input_token: string;
	output_token: string;
	input_amount: number;
	slippage_bps: number;
	protocol: string;
	token_known: boolean;
	token_mint: string;
	userConfirmedRisk?: boolean;
};

/**
 * Internal execution input for the E2E transfer flow.
 * Used by internalExecutor to sign and send after approval gating.
 */
export type ExecuteMcpTransferInput = {
	candidateId: string;
	network: McpSupportedNetwork;
	transactionPayload: ExecuteApprovedActionTransactionPayload;
	approvalProof?: OnchainActionApprovalProof;
};
