import { describe, expect, it } from "vitest";

async function loadMcpToolRegistry() {
	try {
		return await import("../mcp/mcpToolRegistry");
	} catch (error) {
		throw new Error(
			`MCP tool registry implementation is missing or not loadable: ${String(error)}`,
		);
	}
}

async function loadMcpToolContracts() {
	try {
		return await import("../mcp/mcpToolContracts");
	} catch (error) {
		throw new Error(
			`MCP tool contracts implementation is missing or not loadable: ${String(error)}`,
		);
	}
}

describe("MCP tool contracts", () => {
	// T10_1.1: COMPASS_TRANSFER and COMPASS_SWAP in MCP_TOOL_NAMES
	it("defines COMPASS_TRANSFER and COMPASS_SWAP tool name constants", async () => {
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		expect(MCP_TOOL_NAMES.COMPASS_TRANSFER).toBe("compass_transfer");
		expect(MCP_TOOL_NAMES.COMPASS_SWAP).toBe("compass_swap");
	});

	// T10_1.1: Internal-only names remain in MCP_TOOL_NAMES
	it("preserves internal-only tool name constants", async () => {
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		expect(MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION).toBe("execute_approved_action");
		expect(MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION).toBe("sign_and_send_transaction");
		expect(MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL).toBe("create_conditional_buy_sol");
	});

	// T10_1.1: ExecuteMcpTransferInput type is exported
	it("exports ExecuteMcpTransferInput type with required fields", async () => {
		// Type-level check: types are erased at runtime, so we verify
		// the runtime contract structures that ExecuteMcpTransferInput relies on.
		// The type itself is verified by TypeScript compilation (tsc --noEmit).
		//
		// Production behavior check: verify that the internalExecutor can be
		// imported and has the expected executeMcpTransfer function signature,
		// which is the primary consumer of ExecuteMcpTransferInput.
		const executor = await import("../mcp/internalExecutor");
		expect(typeof executor.executeMcpTransfer).toBe("function");

		// Verify CompassTransferInput and CompassSwapInput schema fields via registry
		const registry = await loadMcpToolRegistry();
		const transferSchema = registry.COMPASS_TRANSFER_SCHEMA;
		const swapSchema = registry.COMPASS_SWAP_SCHEMA;

		// CompassTransferInput schema must include core transfer fields + userConfirmedRisk
		expect(transferSchema).toBeDefined();
		expect(transferSchema.properties).toHaveProperty("amountSol");
		expect(transferSchema.properties).toHaveProperty("recipientAddress");
		expect(transferSchema.properties).toHaveProperty("userConfirmedRisk");

		// CompassSwapInput schema must include core swap fields + userConfirmedRisk
		expect(swapSchema).toBeDefined();
		expect(swapSchema.properties).toHaveProperty("input_token");
		expect(swapSchema.properties).toHaveProperty("output_token");
		expect(swapSchema.properties).toHaveProperty("userConfirmedRisk");
	});

	// T10_1.3: CompassTransferInput and CompassSwapInput types + schemas exported
	it("exports CompassTransferInput and CompassSwapInput corresponding schemas in registry", async () => {
		// Types are erased at runtime; verify the schema constants exist
		// (these are the runtime-visible counterparts of the types).
		const registry = await loadMcpToolRegistry();

		expect("COMPASS_TRANSFER_SCHEMA" in registry).toBe(true);
		expect("COMPASS_SWAP_SCHEMA" in registry).toBe(true);
	});
});

describe("MCP tool registry — Wave 10 public surface", () => {
	// T10_2.1 + T10_2.2: Public tool list is compass_transfer, compass_swap, and helpers only
	it("lists compass_transfer and compass_swap as the only public write tools alongside read-only helpers", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const tools = listMcpTools();
		const toolNames = tools.map((t) => t.name);

		// Contains the two E2E write tools
		expect(toolNames).toContain("compass_transfer");
		expect(toolNames).toContain("compass_swap");

		// Contains read-only helpers
		expect(toolNames).toContain("get_usdc_sol_quote");
		expect(toolNames).toContain("quote_swap");
		expect(toolNames).toContain("simulate_conditional_buy_oracle_check");

		// Does NOT contain internal-only tools
		expect(toolNames).not.toContain("execute_approved_action");
		expect(toolNames).not.toContain("sign_and_send_transaction");
		expect(toolNames).not.toContain("create_conditional_buy_sol");

		// Does NOT contain legacy names
		expect(toolNames).not.toContain("guarded_transfer_sol");
		expect(toolNames).not.toContain("guarded_swap_sol_usdc");

		// Only 5 public tools total
		expect(toolNames).toHaveLength(5);
	});

	// T10_2.1: compass_transfer description reflects E2E flow
	it("compass_transfer description mentions transfer and does not say 'prepare'", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const transfer = listMcpTools().find((t) => t.name === "compass_transfer");
		expect(transfer).toBeDefined();
		expect(transfer!.description.toLowerCase()).not.toContain("prepare");
		expect(transfer!.description).toMatch(/transfer/i);
	});

	// T10_2.1: compass_swap description
	it("compass_swap description mentions swap", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const swap = listMcpTools().find((t) => t.name === "compass_swap");
		expect(swap).toBeDefined();
		expect(swap!.description).toMatch(/swap/i);
	});

	// T10_2.3: compass_transfer schema includes userConfirmedRisk
	it("compass_transfer schema includes optional userConfirmedRisk boolean", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const transfer = listMcpTools().find((t) => t.name === "compass_transfer");
		expect(transfer).toBeDefined();
		expect(transfer!.inputSchema.properties).toHaveProperty("userConfirmedRisk");
		expect((transfer!.inputSchema as Record<string, unknown>).properties).toMatchObject({
			userConfirmedRisk: { type: "boolean" },
		});
		// userConfirmedRisk should NOT be in the required fields
		expect(transfer!.inputSchema.required).not.toContain("userConfirmedRisk");
	});

	// T10_2.3: compass_swap schema includes userConfirmedRisk
	it("compass_swap schema includes optional userConfirmedRisk boolean", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const swap = listMcpTools().find((t) => t.name === "compass_swap");
		expect(swap).toBeDefined();
		expect(swap!.inputSchema.properties).toHaveProperty("userConfirmedRisk");
		expect((swap!.inputSchema as Record<string, unknown>).properties).toMatchObject({
			userConfirmedRisk: { type: "boolean" },
		});
		// userConfirmedRisk should NOT be in the required fields
		expect(swap!.inputSchema.required).not.toContain("userConfirmedRisk");
	});

	// T10_2.2: Internal tools not in public list
	it("does not expose raw signer or dangerous execution tools publicly", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const toolNames = listMcpTools().map((t) => t.name);

		expect(toolNames).not.toContain("sign_transaction");
		expect(toolNames).not.toContain("send_raw_transaction");
		expect(toolNames).not.toContain("export_private_key");
		expect(toolNames).not.toContain("legacy_chat_transfer");
	});

	// T10_2.1: compass_transfer has SENSITIVE_EXECUTION risk class
	it("compass_transfer has SENSITIVE_EXECUTION risk class and mutates: true", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const transfer = listMcpTools().find((t) => t.name === "compass_transfer");
		expect(transfer).toMatchObject({
			metadata: {
				riskClass: "SENSITIVE_EXECUTION",
				readOnly: false,
			},
		});
	});

	// T10_2.1: compass_swap has SENSITIVE_EXECUTION risk class
	it("compass_swap has SENSITIVE_EXECUTION risk class and mutates: true", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const swap = listMcpTools().find((t) => t.name === "compass_swap");
		expect(swap).toMatchObject({
			metadata: {
				riskClass: "SENSITIVE_EXECUTION",
				readOnly: false,
			},
		});
	});

	// T10_1.2: compass_transfer schema preserves transfer fields
	it("compass_transfer schema preserves required transfer fields", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const transfer = listMcpTools().find((t) => t.name === "compass_transfer");
		expect(transfer).toBeDefined();
		expect(transfer!.inputSchema.required).toContain("amountSol");
		expect(transfer!.inputSchema.required).toContain("recipientAddress");
		expect(transfer!.inputSchema.properties).toHaveProperty("amountSol");
		expect(transfer!.inputSchema.properties).toHaveProperty("recipientAddress");
		expect(transfer!.inputSchema.properties).toHaveProperty("actorWallet");
		expect(transfer!.inputSchema.properties).toHaveProperty("recipientKnown");
		expect(transfer!.inputSchema.properties).toHaveProperty("walletSafety");
	});

	// T10_1.2: compass_swap schema preserves swap fields
	it("compass_swap schema preserves required swap fields", async () => {
		const { listMcpTools } = await loadMcpToolRegistry();

		const swap = listMcpTools().find((t) => t.name === "compass_swap");
		expect(swap).toBeDefined();
		expect(swap!.inputSchema.required).toContain("input_token");
		expect(swap!.inputSchema.required).toContain("output_token");
		expect(swap!.inputSchema.required).toContain("input_amount");
		expect(swap!.inputSchema.required).toContain("slippage_bps");
		expect(swap!.inputSchema.required).toContain("protocol");
		expect(swap!.inputSchema.required).toContain("token_known");
		expect(swap!.inputSchema.required).toContain("token_mint");
		expect(swap!.inputSchema.properties).toHaveProperty("input_token");
		expect(swap!.inputSchema.properties).toHaveProperty("output_token");
		expect(swap!.inputSchema.properties).toHaveProperty("input_amount");
	});
});