import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import bs58 from "bs58";
import {
	Keypair,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultApprovalIdempotencyStore } from "../approvalIdempotencyStore";
import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import { resetMcpAuditEvents } from "../mcp/mcpAuditSink";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";
import type { SwapGatewayEvaluation } from "../swapGatewayContracts";
import type { TransferGatewayEvaluation } from "../transferGatewayContracts";

const APPROVED_ACTION_HASH = "ab".repeat(32);
const APPROVED_USER = "approved-user";

function createApprovalProof(actionHash = APPROVED_ACTION_HASH) {
	return {
		execute_tx_signature: "proof-signature",
		expected_network: "devnet",
		action_hash: actionHash,
		user: APPROVED_USER,
	};
}

async function loadMcpToolCallRouter() {
	try {
		return await import("../mcp/mcpToolCallRouter");
	} catch (error) {
		throw new Error(
			`Wave 4 MCP tool call router implementation is missing or not loadable: ${String(error)}`,
		);
	}
}

async function loadMcpToolContracts() {
	try {
		return await import("../mcp/mcpToolContracts");
	} catch (error) {
		throw new Error(
			`Wave 4 MCP tool contracts implementation is missing or not loadable: ${String(error)}`,
		);
	}
}

function mockSwapEvaluation(
	overrides: Partial<SwapGatewayEvaluation> = {},
): SwapGatewayEvaluation {
	return {
		classification: {
			toolName: "swap",
			riskClass: "SENSITIVE_EXECUTION",
			defaultDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			auditRequired: true,
			reasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
		},
		candidate: {
			id: "swap-candidate-1",
			chain: "solana",
			network: "devnet",
			toolName: "swap",
			actionKind: "swap",
			actorWallet: "actor-wallet",
			createdAt: "2026-06-08T00:00:00.000Z",
			paramsSummary: {
				inputToken: "SOL",
				outputToken: "USDC",
				inputAmount: 1,
				slippageBps: 500,
				protocol: "Orca",
				tokenMint: "usdc-mint",
			},
		},
		policyContext: {
			amount_usd: 140,
			slippage_bps: 500,
			protocol: "Orca",
			token_known: true,
			token_mint: "usdc-mint",
		},
		policyEvaluation: {
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			policyId: "default-conservative",
			reasonCodes: ["SWAP_SLIPPAGE_EXCEEDS_LIMIT"],
			evaluatedRules: ["swaps.max_slippage_bps"],
		},
		metadata: {
			candidateId: "swap-candidate-1",
			candidateFingerprint: "swap-candidate-fingerprint",
			policyId: "default-conservative",
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			reasonCodes: ["SWAP_SLIPPAGE_EXCEEDS_LIMIT"],
			evaluatedRules: ["swaps.max_slippage_bps"],
			classificationReasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
			contextFingerprint: "swap-context-fingerprint",
			evaluatedAt: "2026-06-08T00:00:00.000Z",
		},
		proposalEligible: true,
		requiresApprovalCard: true,
		...overrides,
	};
}

function mockTransferEvaluation(
	overrides: Partial<TransferGatewayEvaluation> = {},
): TransferGatewayEvaluation {
	return {
		classification: {
			toolName: "transfer",
			riskClass: "SENSITIVE_EXECUTION",
			defaultDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			auditRequired: true,
			reasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
		},
		candidate: {
			id: "transfer-candidate-1",
			chain: "solana",
			network: "devnet",
			toolName: "transfer",
			actionKind: "transfer",
			actorWallet: "actor-wallet",
			createdAt: "2026-06-07T00:00:00.000Z",
			paramsSummary: {
				amountSol: 1,
				token: "SOL",
				recipient: "unknown-recipient",
			},
		},
		policyContext: {
			amount_usd: 150,
			recipient_address: "unknown-recipient",
			recipient_known: false,
		},
		policyEvaluation: {
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			policyId: "default-conservative",
			reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
			evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
		},
		metadata: {
			candidateId: "transfer-candidate-1",
			candidateFingerprint: "candidate-fingerprint",
			policyId: "default-conservative",
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
			evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
			classificationReasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
			contextFingerprint: "context-fingerprint",
			evaluatedAt: "2026-06-07T00:00:00.000Z",
		},
		proposalEligible: true,
		requiresApprovalCard: true,
		...overrides,
	};
}

function listTsFiles(path: string): string[] {
	return readdirSync(path).flatMap((entry) => {
		const entryPath = join(path, entry);
		if (statSync(entryPath).isDirectory()) {
			return listTsFiles(entryPath);
		}
		return entryPath.endsWith(".ts") ? [entryPath] : [];
	});
}

function createUnsignedVersionedTransactionPayload(actionHash = APPROVED_ACTION_HASH) {
	const payer = Keypair.generate();
	const message = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: Keypair.generate().publicKey.toBase58(),
		instructions: [],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);

	return {
		encoding: "base64",
		actionHash,
		unsignedVersionedTransaction: Buffer.from(tx.serialize()).toString("base64"),
	};
}

function mockSignerAdapter(sendMock: ReturnType<typeof vi.fn>, publicKey?: string) {
	const testPublicKey = publicKey ?? Keypair.generate().publicKey.toBase58();
	const signerAdapter = vi.fn().mockReturnValue({
		ok: true,
		adapter: {
			getAddress: vi.fn().mockResolvedValue(testPublicKey),
			signTransaction: vi.fn(),
			signAndSendTransaction: sendMock,
		},
	});
	return signerAdapter;
}

describe("Wave 4 MCP tool call router", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		defaultApprovalIdempotencyStore.clear();
		defaultPendingTransactionStore.clear();
		resetMcpAuditEvents();
		delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;
		delete process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY_B58;
		delete process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY;
		delete process.env.COMPASS_LOCAL_SIGNER_PUBLIC_KEY;
		delete process.env.SOLANA_RPC_URL;
	});

	it("returns ALLOW quote results with audit id", async () => {
		const priceQuote = await import("../priceQuote");
		vi.spyOn(priceQuote, "getUsdcSolQuote").mockResolvedValueOnce({
			network: "devnet",
			provider: "orca_whirlpools_devnet",
			input_token: "USDC",
			output_token: "SOL",
			input_amount: 10,
			output_amount: 0.5,
			input_mint: "usdc-mint",
			output_mint: "sol-mint",
			slippage_bps: 100,
			route_context: "unit-test-route",
			quote_source: "fallback_sol_usd",
			updated_at: "2026-06-07T00:00:00.000Z",
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GET_USDC_SOL_QUOTE,
			arguments: {
				network: "devnet",
				input_token: "USDC",
				output_token: "SOL",
				input_amount: 10,
				slippage_bps: 100,
			},
		});

		expect(result).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.GET_USDC_SOL_QUOTE,
			riskClass: "READ_ONLY",
		});
		expect(result.auditId).toEqual(expect.any(String));
		expect(result.data).toMatchObject({ output_amount: 0.5 });
		expect(priceQuote.getUsdcSolQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				network: "devnet",
				input_token: "USDC",
				output_token: "SOL",
				input_amount: 10,
				slippage_bps: 100,
			}),
		);
	});

	it("returns ALLOW swap quote results with audit id", async () => {
		const priceQuote = await import("../priceQuote");
		vi.spyOn(priceQuote, "getUsdcSolQuote").mockResolvedValueOnce({
			network: "devnet",
			provider: "orca_whirlpools_devnet",
			input_token: "SOL",
			output_token: "USDC",
			input_amount: 1,
			output_amount: 140,
			input_mint: "sol-mint",
			output_mint: "usdc-mint",
			slippage_bps: 100,
			route_context: "unit-test-route",
			quote_source: "fallback_sol_usd",
			updated_at: "2026-06-08T00:00:00.000Z",
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.QUOTE_SWAP,
			arguments: {
				network: "devnet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 100,
			},
		});

		expect(result).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.QUOTE_SWAP,
			riskClass: "PREPARATION_SIMULATION",
		});
		expect(result.auditId).toEqual(expect.any(String));
		expect(result.data).toMatchObject({ output_amount: 140 });
		expect(priceQuote.getUsdcSolQuote).toHaveBeenCalledWith(
			expect.objectContaining({
				network: "devnet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 100,
			}),
		);
	});

	it("guarded_swap_sol_usdc is rejected as unavailable through the public MCP router", async () => {
		const swapGateway = await import("../swapGateway");
		const evaluateSpy = vi.spyOn(swapGateway, "evaluateSwapGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("guarded_swap_sol_usdc with invalid input is still rejected as unavailable through the public MCP router", async () => {
		const swapGateway = await import("../swapGateway");
		const evaluateSpy = vi.spyOn(swapGateway, "evaluateSwapGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			arguments: {
				network: "devnet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("guarded_swap_sol_usdc with unsupported pair is still rejected as unavailable", async () => {
		const swapGateway = await import("../swapGateway");
		const evaluateSpy = vi.spyOn(swapGateway, "evaluateSwapGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			arguments: {
				network: "devnet",
				input_token: "USDC",
				output_token: "BONK",
				input_amount: 1,
				slippage_bps: 100,
				protocol: "Orca",
				token_known: true,
				token_mint: "bonk-mint",
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("returns ALLOW conditional oracle simulation results with audit id", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.SIMULATE_CONDITIONAL_BUY_ORACLE_CHECK,
			arguments: {
				network: "devnet",
				oracleFeedPubkey: "pyth-sol-usd-devnet",
				oraclePriceUsd: 135,
				oracleAgeSeconds: 15,
				maxOracleAgeSeconds: 60,
				oracleConfidenceBps: 25,
				maxConfidenceBps: 100,
			},
		});

		expect(result).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.SIMULATE_CONDITIONAL_BUY_ORACLE_CHECK,
			riskClass: "PREPARATION_SIMULATION",
			data: {
				oracleFeedPubkey: "pyth-sol-usd-devnet",
				oraclePriceUsd: 135,
				withinMaxAge: true,
				withinMaxConfidence: true,
			},
		});
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("create_conditional_buy_sol is rejected as unavailable through the public MCP router", async () => {
		const conditionalGateway = await import("../conditionalGateway");
		const evaluateSpy = vi.spyOn(conditionalGateway, "evaluateConditionalGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				inputAmountUsdc: 50,
				targetPriceUsd: 130,
				maxSlippageBps: 100,
				oracleFeedPubkey: "pyth-sol-usd-devnet",
				oraclePriceUsd: 135,
				oracleAgeSeconds: 15,
				maxOracleAgeSeconds: 60,
				oracleConfidenceBps: 25,
				maxConfidenceBps: 100,
				recipient: "actor-wallet",
				expiresAtUnix: 1_780_970_000,
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("create_conditional_buy_sol with invalid input is still rejected as unavailable", async () => {
		const conditionalGateway = await import("../conditionalGateway");
		const evaluateSpy = vi.spyOn(
			conditionalGateway,
			"evaluateConditionalGateway",
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL,
			arguments: {
				network: "devnet",
				inputAmountUsdc: 50,
				targetPriceUsd: 130,
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("guarded_transfer_sol is rejected as unavailable through the public MCP router", async () => {
		const transferGateway = await import("../transferGateway");
		const evaluateSpy = vi.spyOn(transferGateway, "evaluateTransferGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("compass_transfer defaults actorWallet from local signer and treats omitted recipientKnown as unknown", async () => {
		const testKeypair = Keypair.generate();
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY = bs58.encode(
			testKeypair.secretKey,
		);
		process.env.COMPASS_LOCAL_SIGNER_PUBLIC_KEY = testKeypair.publicKey.toBase58();

		const transferGateway = await import("../transferGateway");
		const evaluateTransferGatewaySpy = vi.spyOn(
			transferGateway,
			"evaluateTransferGateway",
		);
		evaluateTransferGatewaySpy.mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.DENY,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
					evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 0.1,
				recipientAddress: testKeypair.publicKey.toBase58(),
			},
		});

		// Verify actorWallet was defaulted from the local signer
		expect(evaluateTransferGatewaySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				actorWallet: testKeypair.publicKey.toBase58(),
				recipientKnown: false,
			}),
		);
	});

	it("denies direct sign-and-send calls fail closed with compass_transfer and compass_swap message", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION,
			arguments: {
				compass_built: true,
				rawTransaction: "must-not-leak",
			},
		});

		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("DIRECT_SIGN_AND_SEND_BLOCKED");
		expect(result.message).toContain("compass_transfer");
		expect(result.message).toContain("compass_swap");
		expect(result.message).not.toContain("execute_approved_action");
		expect(JSON.stringify(result)).not.toContain("must-not-leak");
		expect(result.auditId).toEqual(expect.any(String));

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		expect(JSON.stringify(listMcpAuditEvents().at(-1))).not.toContain(
			"must-not-leak",
		);
	});

	it("execute_approved_action is no longer a public MCP route and returns DENY for all arguments", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		// No arguments
		const resultNoArgs = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {},
		});
		expect(resultNoArgs.ok).toBe(false);
		expect(resultNoArgs.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(resultNoArgs.toolName).toBe(MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION);

		// With candidateId and transactionPayload (would previously have been processed)
		const resultWithPayload = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "some-candidate-id",
				transactionPayload: {
					encoding: "base64",
					actionHash: "ab".repeat(32),
					unsignedVersionedTransaction: "dHgtYnl0ZXM=",
				},
			},
		});
		expect(resultWithPayload.ok).toBe(false);
		expect(resultWithPayload.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(resultWithPayload.toolName).toBe(MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION);

		// With approval proof (would previously have triggered proof verification)
		const resultWithProof = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "some-candidate-id",
				approvalProof: createApprovalProof(),
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});
		expect(resultWithProof.ok).toBe(false);
		expect(resultWithProof.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(resultWithProof.toolName).toBe(MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION);
	});

	it("denies unknown mutating tools fail closed", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();

		const result = await handleMcpToolCall({
			toolName: "send_raw_transaction",
			mutates: true,
			arguments: { rawTransaction: "must-not-leak" },
		});

		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: "send_raw_transaction",
			riskClass: "BLOCKED_UNKNOWN",
		});
		expect(result.reasonCodes).toContain("UNKNOWN_MUTATING_TOOL");
		expect(JSON.stringify(result)).not.toContain("must-not-leak");
		expect(result.auditId).toEqual(expect.any(String));
	});


	it("guarded_transfer_sol with invalid input is still rejected as unavailable", async () => {
		const transferGateway = await import("../transferGateway");
		const evaluateSpy = vi.spyOn(transferGateway, "evaluateTransferGateway");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 0,
			},
		});

		// Gateway should not be called — the tool is blocked before routing
		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL);
		expect(result.message).toMatch(/unavailable|unsupported|blocked/i);
	});

	it("MCP modules do not import from legacy", () => {
		const files = listTsFiles(join(process.cwd(), "back/services/mcp"));
		const legacyImportPattern =
			/from\s+["'][^"']*legacy|import\s*\([^)]*legacy/;

		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source, file).not.toMatch(legacyImportPattern);
		}
	});

	// --- T10_4.1: compass_transfer E2E tests ---

	it("compass_transfer: devnet transfer succeeds with userConfirmedRisk=true and local signer", async () => {
		const testKeypair = Keypair.generate();
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY = bs58.encode(
			testKeypair.secretKey,
		);
		process.env.COMPASS_LOCAL_SIGNER_PUBLIC_KEY = testKeypair.publicKey.toBase58();

		const sendMock = vi.fn().mockResolvedValue("compass-transfer-devnet-sig");
		const signerAdapter = await import("../signerAdapter");
		vi.spyOn(signerAdapter, "createSignerAdapter").mockImplementation(
			mockSignerAdapter(sendMock, testKeypair.publicKey.toBase58()) as never,
		);
		const { Connection } = await import("@solana/web3.js");
		vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
			blockhash: Keypair.generate().publicKey.toBase58(),
			lastValidBlockHeight: 0,
		} as never);
		vi.spyOn(Connection.prototype, "sendRawTransaction").mockResolvedValue(
			"compass-transfer-devnet-sig" as never,
		);
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
					evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: testKeypair.publicKey.toBase58(),
				recipientKnown: false,
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(true);
		expect(result.decision).toBe(COMPASS_DECISIONS.ALLOW);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.data).toMatchObject({
			signerPath: "local_keypair",
			executionStatus: "executed",
		});
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("compass_transfer: devnet transfer without userConfirmedRisk when approval required returns REQUIRE_HUMAN_APPROVAL", async () => {
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
					evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
				},
			}),
		);
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "invalid-addr-for-routing",
				recipientKnown: false,
				actorWallet: "explicit-actor-wallet",
				userConfirmedRisk: false,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(signerSpy).not.toHaveBeenCalled();
	});

it("compass_transfer: non-devnet mainnet-beta REQUIRE_HUMAN_APPROVAL with userConfirmedRisk is still blocked", async () => {
		// Non-devnet is blocked before gateway/signer interaction regardless
		// of policy decision, so no mocks are needed.
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "mainnet-beta",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.message).toContain("External production approval");
		expect(result.reasonCodes).toContain("NON_DEVNET_EXECUTION_BLOCKED");
	});

	it("compass_transfer: DENY returns clear denial without executing", async () => {
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.DENY,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_BLOCKED_RECIPIENT"],
					evaluatedRules: ["transfers.blocked_recipients"],
				},
			}),
		);
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "blocked-recipient",
				recipientKnown: false,
				actorWallet: "explicit-actor-wallet",
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.reasonCodes).toContain("TRANSFER_BLOCKED_RECIPIENT");
		expect(signerSpy).not.toHaveBeenCalled();
	});

	// --- T10_4.2: compass_swap policy-only + pending builder tests ---

	it("compass_swap: ALLOW with executionStatus pending_builder", async () => {
		const swapGateway = await import("../swapGateway");
		vi.spyOn(swapGateway, "evaluateSwapGateway").mockResolvedValueOnce(
			mockSwapEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.ALLOW,
					policyId: "default-conservative",
					reasonCodes: ["SWAP_KNOWN_TOKEN_ALLOW"],
					evaluatedRules: ["swaps.default"],
				},
				proposalEligible: false,
				requiresApprovalCard: false,
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_SWAP,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(true);
		expect(result.decision).toBe(COMPASS_DECISIONS.ALLOW);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_SWAP);
		expect(result.data).toMatchObject({
			executionStatus: "pending_builder",
		});
	});

	it("compass_swap: DENY returns denial without faking execution", async () => {
		const swapGateway = await import("../swapGateway");
		vi.spyOn(swapGateway, "evaluateSwapGateway").mockResolvedValueOnce(
			mockSwapEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.DENY,
					policyId: "default-conservative",
					reasonCodes: ["SWAP_DENY_TOKEN_NOT_LISTED"],
					evaluatedRules: ["swaps.deny_non_listed"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_SWAP,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_SWAP);
	});

// --- Blocker 2: Non-devnet compass_transfer must block before payload build/sign ---

	it("compass_transfer: non-devnet mainnet-beta ALLOW is still blocked before any gateway or signer call", async () => {
		// Policy is NOT mocked — non-devnet guard must block before the
		// gateway is ever called, so any call would throw.
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "mainnet-beta",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.message).toContain("External production approval");
		expect(result.message).toContain("userConfirmedRisk");
		expect(result.reasonCodes).toContain("NON_DEVNET_EXECUTION_BLOCKED");
	});

	it("compass_transfer: testnet ALLOW is also blocked before any gateway or signer call", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "testnet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.message).toContain("External production approval");
		expect(result.reasonCodes).toContain("NON_DEVNET_EXECUTION_BLOCKED");
	});

	// --- T10_4.3: execute_approved_action no longer a public route ---

	it("execute_approved_action is rejected as unavailable in the public MCP switch", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "some-candidate-id",
			},
		});

		expect(result.ok).toBe(false);
		// Should be either DENY or REQUIRE_ADDITIONAL_CONTEXT indicating it's not available
		expect(
			result.decision === COMPASS_DECISIONS.DENY ||
			result.decision === COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
		).toBe(true);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION);
	});

	// --- T10_4.4: denyRegisteredTool message references compass_transfer and compass_swap ---

	it("sign_and_send_transaction deny message references compass_transfer and compass_swap", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.SIGN_AND_SEND_TRANSACTION,
			arguments: { compass_built: true },
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.message).toContain("compass_transfer");
		expect(result.message).toContain("compass_swap");
		// Should NOT reference the old pattern
		expect(result.message).not.toContain("execute_approved_action");
	});

	// --- Remediation: compass_transfer invalid/additional-context path ---

	it("compass_transfer: REQUIRE_ADDITIONAL_CONTEXT returns missing-context result without executing", async () => {
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_MISSING_RECIPIENT_CONTEXT"],
					evaluatedRules: ["transfers.additional_context"],
				},
			}),
		);
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				actorWallet: "explicit-actor-wallet",
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.reasonCodes).toContain("TRANSFER_MISSING_RECIPIENT_CONTEXT");
		// Must not call signer — no execution
		expect(signerSpy).not.toHaveBeenCalled();
	});

	it("compass_transfer: invalid input (missing amountSol) returns REQUIRE_ADDITIONAL_CONTEXT", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				recipientAddress: "some-address",
				// amountSol missing
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.reasonCodes).toContain("INVALID_TRANSFER_INPUT");
	});

	// --- Remediation: Non-devnet compass_swap blocks with userConfirmedRisk ---

	it("compass_swap: non-devnet with userConfirmedRisk still returns pending_builder (swap does not execute)", async () => {
		const swapGateway = await import("../swapGateway");
		vi.spyOn(swapGateway, "evaluateSwapGateway").mockResolvedValueOnce(
			mockSwapEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
					policyId: "default-conservative",
					reasonCodes: ["SWAP_REQUIRES_APPROVAL"],
					evaluatedRules: ["swaps.require_approval"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_SWAP,
			arguments: {
				network: "mainnet-beta",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_SWAP);
		expect(result.data).toMatchObject({
			executionStatus: "pending_builder",
			externalApprovalRequired: true,
		});
		// Swap never executes — no signature or execution evidence
		expect(result.data).not.toHaveProperty("signature");
		expect(result.data).not.toHaveProperty("signerPath");
	});

	it("compass_swap: devnet ALLOW returns pending_builder without faking execution", async () => {
		const swapGateway = await import("../swapGateway");
		vi.spyOn(swapGateway, "evaluateSwapGateway").mockResolvedValueOnce(
			mockSwapEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.ALLOW,
					policyId: "default-conservative",
					reasonCodes: ["SWAP_KNOWN_TOKEN_ALLOW"],
					evaluatedRules: ["swaps.default"],
				},
				proposalEligible: false,
				requiresApprovalCard: false,
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_SWAP,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
				userConfirmedRisk: true,
			},
		});

		expect(result.ok).toBe(true);
		expect(result.decision).toBe(COMPASS_DECISIONS.ALLOW);
		expect(result.data).toMatchObject({
			executionStatus: "pending_builder",
		});
		expect(result.data).not.toHaveProperty("signature");
		expect(result.data).not.toHaveProperty("signerPath");
	});

	// --- Remediation: LLM approval boundary ---

	it("compass_transfer: LLM recommendation to ALLOW must not override gateway DENY", async () => {
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.DENY,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_BLOCKED_DENY"],
					evaluatedRules: ["transfers.blocked"],
				},
			}),
		);
		// Mock LLM to recommend ALLOW (which must not override the DENY)
		const llmDecisionAdapter = await import("../llmDecisionAdapter");
		vi.spyOn(llmDecisionAdapter, "resolveLlmConfig").mockReturnValueOnce({
			enabled: true,
			provider: "openai",
			model: "gpt-4",
			apiKey: "test-key",
			clampToDeterministic: true,
		} as never);
		const { LLM_GUARD_DECISIONS } = await import("../llmDecisionContracts");
		vi.spyOn(llmDecisionAdapter, "evaluateLlmMetadata").mockResolvedValueOnce({
			llmConsulted: true,
			llmOutput: {
				decision: LLM_GUARD_DECISIONS.ALLOW,
				confidence: 0.95,
				reasonCodes: ["LLM_OVERRIDE_ALLOW"],
				rationale: "LLM recommends allowing this transfer",
			},
			decision: COMPASS_DECISIONS.DENY, // clamped: DENY cannot be loosened
			clamped: true,
			llmRationale: "Deterministic DENY cannot be overridden by LLM ALLOW",
		} as never);
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "blocked-recipient",
				recipientKnown: false,
				actorWallet: "explicit-actor-wallet",
				userConfirmedRisk: true,
			},
		});

		// Deterministic DENY must win even when LLM says ALLOW
		expect(result.ok).toBe(false);
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
		expect(result.toolName).toBe(MCP_TOOL_NAMES.COMPASS_TRANSFER);
		expect(result.reasonCodes).toContain("TRANSFER_BLOCKED_DENY");
		expect(signerSpy).not.toHaveBeenCalled();
	});

	// --- Remediation: Approval response must NOT expose transactionPayload/executionPayload ---

	it("compass_transfer: approval response for devnet without userConfirmedRisk must not expose transactionPayload or executionPayload", async () => {
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
					evaluatedRules: ["transfers.require_approval_for_unknown_recipient"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const response = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				actorWallet: "explicit-actor-wallet",
				userConfirmedRisk: false,
			},
		});

		expect(response.ok).toBe(false);
		expect(response.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
		// Public response must NOT contain raw internal payload fields
		const data = response.data as Record<string, unknown> | undefined;
		expect(data?.transactionPayload).toBeUndefined();
		expect(data?.executionPayload).toBeUndefined();
	});

	it("compass_transfer: non-devnet approval response must not expose transactionPayload or executionPayload", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const response = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_TRANSFER,
			arguments: {
				network: "mainnet-beta",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				userConfirmedRisk: true,
			},
		});

		expect(response.ok).toBe(false);
		expect(response.decision).toBe(COMPASS_DECISIONS.DENY);
		// DENY response must not expose internal payloads
		const data = response.data as Record<string, unknown> | undefined;
		expect(data?.transactionPayload).toBeUndefined();
		expect(data?.executionPayload).toBeUndefined();
	});

	it("compass_swap: response must not expose transactionPayload or executionPayload", async () => {
		const swapGateway = await import("../swapGateway");
		vi.spyOn(swapGateway, "evaluateSwapGateway").mockResolvedValueOnce(
			mockSwapEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.ALLOW,
					policyId: "default-conservative",
					reasonCodes: ["SWAP_KNOWN_TOKEN_ALLOW"],
					evaluatedRules: ["swaps.default"],
				},
				proposalEligible: false,
				requiresApprovalCard: false,
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const response = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.COMPASS_SWAP,
			arguments: {
				network: "devnet",
				actorWallet: "actor-wallet",
				input_token: "SOL",
				output_token: "USDC",
				input_amount: 1,
				slippage_bps: 500,
				protocol: "Orca",
				token_known: true,
				token_mint: "usdc-mint",
			},
		});

		// No internal payloads exposed
		const data = response.data as Record<string, unknown> | undefined;
		expect(data?.transactionPayload).toBeUndefined();
		expect(data?.executionPayload).toBeUndefined();
	});
});
