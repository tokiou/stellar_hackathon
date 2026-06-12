import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import bs58 from "bs58";
import {
	Connection,
	Keypair,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultApprovalIdempotencyStore } from "../approvalIdempotencyStore";
import type { ConditionalGatewayEvaluation } from "../conditionalGatewayContracts";
import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import { resetMcpAuditEvents } from "../mcp/mcpAuditSink";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";
import type { SwapGatewayEvaluation } from "../swapGatewayContracts";
import type { TransferGatewayEvaluation } from "../transferGatewayContracts";

const APPROVED_ACTION_HASH = "ab".repeat(32);
const OTHER_ACTION_HASH = "cd".repeat(32);
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

function mockConditionalEvaluation(
	overrides: Partial<ConditionalGatewayEvaluation> = {},
): ConditionalGatewayEvaluation {
	return {
		classification: {
			toolName: "conditional_buy_sol",
			riskClass: "SENSITIVE_EXECUTION",
			defaultDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			auditRequired: true,
			reasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
		},
		candidate: {
			id: "conditional-candidate-1",
			chain: "solana",
			network: "devnet",
			toolName: "conditional_buy_sol",
			actionKind: "conditional_buy",
			actorWallet: "actor-wallet",
			createdAt: "2026-06-09T00:00:00.000Z",
			paramsSummary: {
				inputToken: "USDC",
				inputAmountUsdc: 50,
				targetPriceUsd: 130,
				maxSlippageBps: 100,
				oracleFeedPubkey: "pyth-sol-usd-devnet",
				recipient: "actor-wallet",
				expiresAtUnix: 1780970000,
			},
		},
		policyContext: {
			amount_usd: 50,
			target_price_usd: 130,
			slippage_bps: 100,
			oracle_feed_pubkey: "pyth-sol-usd-devnet",
			oracle_price_usd: 135,
			oracle_age_seconds: 15,
			max_oracle_age_seconds: 60,
			oracle_confidence_bps: 25,
			max_confidence_bps: 100,
			recipient_address: "actor-wallet",
			expires_at_unix: 1780970000,
			current_unix_timestamp: 1780966400,
		},
		policyEvaluation: {
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			policyId: "default-conservative",
			reasonCodes: ["CONDITIONAL_DEFAULT_REQUIRES_APPROVAL"],
			evaluatedRules: ["conditional_buys.default"],
		},
		metadata: {
			candidateId: "conditional-candidate-1",
			candidateFingerprint: "conditional-candidate-fingerprint",
			policyId: "default-conservative",
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			reasonCodes: ["CONDITIONAL_DEFAULT_REQUIRES_APPROVAL"],
			evaluatedRules: ["conditional_buys.default"],
			classificationReasonCodes: ["KNOWN_SENSITIVE_EXECUTION_TOOL"],
			contextFingerprint: "conditional-context-fingerprint",
			evaluatedAt: "2026-06-09T00:00:00.000Z",
		},
		proposalEligible: true,
		requiresApprovalCard: true,
		...overrides,
	};
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

	it("returns REQUIRE_HUMAN_APPROVAL guarded swap results with approval metadata", async () => {
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
			slippage_bps: 500,
			route_context: "unit-test-route",
			quote_source: "fallback_sol_usd",
			updated_at: "2026-06-08T00:00:00.000Z",
		});
		const swapGateway = await import("../swapGateway");
		const evaluateSpy = vi
			.spyOn(swapGateway, "evaluateSwapGateway")
			.mockResolvedValueOnce(mockSwapEvaluation());
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

		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "swap",
				inputToken: "SOL",
				outputToken: "USDC",
				inputAmount: 1,
				slippageBps: 500,
				protocol: "Orca",
				tokenKnown: true,
				tokenMint: "usdc-mint",
				quoteUsd: expect.any(Function),
			}),
		);
		const swapGatewayInput = evaluateSpy.mock.calls[0]?.[0];
		expect(await swapGatewayInput?.quoteUsd?.()).toEqual({
			amountUsd: 140,
			source: "fallback_sol_usd",
		});
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			riskClass: "SENSITIVE_EXECUTION",
			reasonCodes: ["SWAP_SLIPPAGE_EXCEEDS_LIMIT"],
			approval: {
				required: true,
				metadata: {
					candidateId: "swap-candidate-1",
					policyId: "default-conservative",
				},
			},
		});
		expect(JSON.stringify(result)).not.toContain("rawTransaction");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT for invalid guarded swap input", async () => {
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

		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			riskClass: "SENSITIVE_EXECUTION",
		});
		expect(result.reasonCodes).toContain("INVALID_SWAP_INPUT");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT for unsupported guarded swap pairs", async () => {
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

		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.GUARDED_SWAP_SOL_USDC,
			riskClass: "SENSITIVE_EXECUTION",
		});
		expect(result.reasonCodes).toContain("UNSUPPORTED_SWAP_PAIR");
		expect(result.auditId).toEqual(expect.any(String));
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

	it("returns REQUIRE_HUMAN_APPROVAL conditional order results with approval metadata", async () => {
		const conditionalGateway = await import("../conditionalGateway");
		const evaluateSpy = vi
			.spyOn(conditionalGateway, "evaluateConditionalGateway")
			.mockResolvedValueOnce(mockConditionalEvaluation());
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
				currentUnixTimestamp: 1_780_966_400,
			},
		});

		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "conditional_buy_sol",
				inputToken: "USDC",
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
				currentUnixTimestamp: 1_780_966_400,
			}),
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			toolName: MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL,
			riskClass: "SENSITIVE_EXECUTION",
			reasonCodes: ["CONDITIONAL_DEFAULT_REQUIRES_APPROVAL"],
			approval: {
				required: true,
				metadata: {
					candidateId: "conditional-candidate-1",
					policyId: "default-conservative",
				},
			},
		});
		expect(JSON.stringify(result)).not.toContain("rawTransaction");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT for invalid conditional order input", async () => {
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

		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.CREATE_CONDITIONAL_BUY_SOL,
			riskClass: "SENSITIVE_EXECUTION",
		});
		expect(result.reasonCodes).toContain("INVALID_CONDITIONAL_INPUT");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_HUMAN_APPROVAL transfer results with approval metadata", async () => {
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
			updated_at: "2026-06-07T00:00:00.000Z",
		});
		const transferGateway = await import("../transferGateway");
		const evaluateSpy = vi
			.spyOn(transferGateway, "evaluateTransferGateway")
			.mockResolvedValueOnce(mockTransferEvaluation());
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

		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "transfer",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
				quoteUsd: expect.any(Function),
			}),
		);
		const transferGatewayInput = evaluateSpy.mock.calls[0]?.[0];
		expect(await transferGatewayInput?.quoteUsd?.()).toEqual({
			amountUsd: 140,
			source: "fallback_sol_usd",
		});
		expect(priceQuote.getUsdcSolQuote).toHaveBeenCalledWith({
			network: "devnet",
			input_token: "SOL",
			output_token: "USDC",
			input_amount: 1,
		});
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			riskClass: "SENSITIVE_EXECUTION",
			reasonCodes: ["TRANSFER_UNKNOWN_RECIPIENT"],
			approval: {
				required: true,
				metadata: {
					candidateId: "transfer-candidate-1",
					policyId: "default-conservative",
				},
			},
		});
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("defaults transfer actorWallet from local signer and treats omitted recipientKnown as unknown", async () => {
		const testKeypair = Keypair.generate();
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY = bs58.encode(
			testKeypair.secretKey,
		);
		process.env.COMPASS_LOCAL_SIGNER_PUBLIC_KEY = testKeypair.publicKey.toBase58();

		const priceQuote = await import("../priceQuote");
		vi.spyOn(priceQuote, "getUsdcSolQuote").mockResolvedValueOnce({
			network: "devnet",
			provider: "orca_whirlpools_devnet",
			input_token: "SOL",
			output_token: "USDC",
			input_amount: 0.1,
			output_amount: 14,
			input_mint: "sol-mint",
			output_mint: "usdc-mint",
			slippage_bps: 100,
			route_context: "unit-test-route",
			quote_source: "fallback_sol_usd",
			updated_at: "2026-06-07T00:00:00.000Z",
		});
		const transferGateway = await import("../transferGateway");
		const evaluateSpy = vi
			.spyOn(transferGateway, "evaluateTransferGateway")
			.mockResolvedValueOnce(mockTransferEvaluation());
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 0.1,
				recipientAddress: "unknown-recipient",
			},
		});

		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				actorWallet: testKeypair.publicKey.toBase58(),
				recipientKnown: false,
			}),
		);
	});

	it("denies direct sign-and-send calls fail closed", async () => {
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
		expect(result.message).toContain("execute_approved_action");
		expect(JSON.stringify(result)).not.toContain("must-not-leak");
		expect(result.auditId).toEqual(expect.any(String));

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		expect(JSON.stringify(listMcpAuditEvents().at(-1))).not.toContain(
			"must-not-leak",
		);
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT when execute_approved_action is missing candidateId", async () => {
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {},
		});

		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("INVALID_EXECUTE_APPROVED_ACTION_INPUT");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("denies devnet approval bypass when payload has no pending store entry (arbitrary devnet payload)", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-missing-proof",
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: "dHgtYnl0ZXM=",
				},
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-missing-proof")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain(
			"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE",
		);
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("rejects invalid transaction payload bytes on devnet bypass even with store match", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");

		// Record a payload in the store with invalid-transaction bytes so the
		// store match passes but deserialization fails.
		defaultPendingTransactionStore.record({
			candidateId: "candidate-devnet-invalid-tx",
			actionHash: APPROVED_ACTION_HASH,
			unsignedVersionedTransaction: Buffer.from("not-a-valid-transaction").toString("base64"),
			network: "devnet",
			tool: "guarded_transfer_sol",
			action: "transfer",
		});

		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-devnet-invalid-tx",
				network: "devnet",
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: Buffer.from("not-a-valid-transaction").toString("base64"),
				},
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-devnet-invalid-tx")).toBe(false);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("INVALID_TRANSACTION_PAYLOAD");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("requires approvalProof outside devnet demo execution", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-testnet-missing-proof",
				network: "testnet",
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: "dHgtYnl0ZXM=",
				},
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-testnet-missing-proof")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("MISSING_APPROVAL_PROOF");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT without consuming idempotency when execute_approved_action is missing transactionPayload", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-missing-payload",
				approvalProof: createApprovalProof(),
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-missing-payload")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("MISSING_TRANSACTION_PAYLOAD");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT without signer lookup when approval proof lacks action binding", async () => {
		const onchainApproval = await import("../onchainApproval");
		const verifySpy = vi.spyOn(onchainApproval, "verifyActionApproval");
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-incomplete-proof",
				approvalProof: {
					execute_tx_signature: "proof-signature",
					expected_network: "devnet",
				},
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});

		expect(verifySpy).not.toHaveBeenCalled();
		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-incomplete-proof")).toBe(false);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
			reasonCodes: ["INCOMPLETE_APPROVAL_PROOF"],
		});
	});

	it("denies execution when approval proof action hash does not match transaction payload", async () => {
		const onchainApproval = await import("../onchainApproval");
		const verifySpy = vi.spyOn(onchainApproval, "verifyActionApproval");
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-mismatched-action-hash",
				approvalProof: createApprovalProof(APPROVED_ACTION_HASH),
				transactionPayload: createUnsignedVersionedTransactionPayload(OTHER_ACTION_HASH),
			},
		});

		expect(verifySpy).not.toHaveBeenCalled();
		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-mismatched-action-hash")).toBe(false);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
			reasonCodes: ["APPROVAL_TRANSACTION_ACTION_HASH_MISMATCH"],
		});
	});

	it("denies duplicate execute_approved_action candidate IDs before signer lookup", async () => {
		defaultApprovalIdempotencyStore.consume("candidate-duplicate");
		const onchainApproval = await import("../onchainApproval");
		vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
			ok: true,
		});
		const signerAdapter = await import("../signerAdapter");
		const sendSpy = vi.fn();
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter").mockReturnValue({
			ok: true,
			adapter: {
				getAddress: vi.fn(),
				signTransaction: vi.fn(),
				signAndSendTransaction: sendSpy,
			},
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-duplicate",
				approvalProof: createApprovalProof(),
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});

		expect(signerSpy).toHaveBeenCalledOnce();
		expect(sendSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
			reasonCodes: ["DUPLICATE_APPROVAL_EXECUTION"],
		});
		expect(result.auditId).toEqual(expect.any(String));

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		expect(listMcpAuditEvents().at(-1)).toMatchObject({
			decision: COMPASS_DECISIONS.DENY,
			metadata: {
				candidateId: "candidate-duplicate",
				duplicateBlocked: true,
				signerPath: "not_reached",
			},
		});
	});

	it("denies execute_approved_action when approval proof verification fails before signer lookup or idempotency", async () => {
		const onchainApproval = await import("../onchainApproval");
		const verifySpy = vi
			.spyOn(onchainApproval, "verifyActionApproval")
			.mockResolvedValueOnce({
				ok: false,
				reason: "ONCHAIN_ACTION_APPROVAL_EXPIRED",
			});
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-expired-proof",
				approvalProof: createApprovalProof(),
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: "dHgtYnl0ZXM=",
				},
			},
		});

		expect(verifySpy).toHaveBeenCalledWith({
			execute_tx_signature: "proof-signature",
			expected_network: "devnet",
			action_hash: APPROVED_ACTION_HASH,
			user: APPROVED_USER,
		});
		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-expired-proof")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
			reasonCodes: ["ONCHAIN_ACTION_APPROVAL_EXPIRED"],
		});
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("denies execute_approved_action when local signer is not configured", async () => {
		delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;
		const onchainApproval = await import("../onchainApproval");
		vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
			ok: true,
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-ready",
				approvalProof: createApprovalProof(),
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});

		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
			reasonCodes: ["LOCAL_SIGNER_NOT_CONFIGURED"],
			data: {
				candidateId: "candidate-ready",
				signerPath: "not_reached",
			},
		});
		expect(JSON.stringify(result)).not.toContain("rawTransaction");
		expect(result.auditId).toEqual(expect.any(String));
		expect(defaultApprovalIdempotencyStore.has("candidate-ready")).toBe(false);

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		expect(listMcpAuditEvents().at(-1)).toMatchObject({
			decision: COMPASS_DECISIONS.DENY,
			metadata: {
				candidateId: "candidate-ready",
				duplicateBlocked: false,
				signerPath: "not_reached",
			},
		});
	});

	it("executes approved action once and blocks duplicate retry after execution boundary", async () => {
		const onchainApproval = await import("../onchainApproval");
		vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValue({
			ok: true,
		});
		const signerAdapter = await import("../signerAdapter");
		const sendSpy = vi.fn().mockResolvedValue("real-signature");
		vi.spyOn(signerAdapter, "createSignerAdapter").mockReturnValue({
			ok: true,
			adapter: {
				getAddress: vi.fn(),
				signTransaction: vi.fn(),
				signAndSendTransaction: sendSpy,
			},
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();
		const input = {
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-execute-once",
				approvalProof: createApprovalProof(),
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		};

		const first = await handleMcpToolCall(input);
		const second = await handleMcpToolCall(input);

		expect(first).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			data: {
				candidateId: "candidate-execute-once",
				signerPath: "local_keypair",
				signature: "real-signature",
			},
		});
		expect(second).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			reasonCodes: ["DUPLICATE_APPROVAL_EXECUTION"],
		});
		expect(sendSpy).toHaveBeenCalledTimes(1);
		expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(VersionedTransaction);
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

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		expect(JSON.stringify(listMcpAuditEvents().at(-1))).not.toContain(
			"must-not-leak",
		);
	});

	it("returns REQUIRE_ADDITIONAL_CONTEXT for invalid transfer input", async () => {
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

		expect(evaluateSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			riskClass: "SENSITIVE_EXECUTION",
		});
		expect(result.reasonCodes).toContain("INVALID_TRANSFER_INPUT");
		expect(result.auditId).toEqual(expect.any(String));
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

	it("rejects invalid transaction payload bytes before signer lookup and idempotency consumption", async () => {
		const onchainApproval = await import("../onchainApproval");
		vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
			ok: true,
		});
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-invalid-bytes",
				approvalProof: createApprovalProof(),
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: Buffer.from("not-a-valid-transaction").toString("base64"),
				},
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-invalid-bytes")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain("INVALID_TRANSACTION_PAYLOAD");
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("executes approved action through real signer factory path with local env config", async () => {
		const testKeypair = Keypair.generate();
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY_B58 = bs58.encode(
			testKeypair.secretKey,
		);

		const sendRawTransaction = vi
			.spyOn(Connection.prototype, "sendRawTransaction")
			.mockResolvedValue("env-factory-signature" as never);

		const onchainApproval = await import("../onchainApproval");
		vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValue({
			ok: true,
		});

		const signerAdapter = await import("../signerAdapter");
		const createSignerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		// Do NOT mock createSignerAdapter - let the real factory run.

		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		// Create a transaction whose fee payer matches the env keypair so
		// VersionedTransaction.sign() succeeds with the real signer adapter.
		const txMessage = new TransactionMessage({
			payerKey: testKeypair.publicKey,
			recentBlockhash: Keypair.generate().publicKey.toBase58(),
			instructions: [],
		}).compileToV0Message();
		const unsignedTx = new VersionedTransaction(txMessage);
		const transactionPayload = {
			encoding: "base64" as const,
			actionHash: APPROVED_ACTION_HASH,
			unsignedVersionedTransaction: Buffer.from(unsignedTx.serialize()).toString("base64"),
		};

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-env-factory",
				approvalProof: createApprovalProof(),
				transactionPayload,
			},
		});

		// The real factory must have been called (not mocked away).
		expect(createSignerSpy).toHaveBeenCalledOnce();
		expect(createSignerSpy.mock.results[0]?.value?.ok).toBe(true);

		expect(result).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			data: {
				candidateId: "candidate-env-factory",
				signerPath: "local_keypair",
				signature: "env-factory-signature",
			},
		});
		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
		const [submittedBytes] = sendRawTransaction.mock.calls[0];
		expect(submittedBytes).toBeInstanceOf(Uint8Array);
		expect(submittedBytes.length).toBeGreaterThan(0);
	});

	it("preserves deterministic DENY when LLM is disabled (no COMPASS_LLM_DECISION_ENABLED)", async () => {
		delete process.env.COMPASS_LLM_DECISION_ENABLED;
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation({
				policyEvaluation: {
					decision: COMPASS_DECISIONS.DENY,
					policyId: "default-conservative",
					reasonCodes: ["TRANSFER_AMOUNT_EXCEEDS_LIMIT"],
					evaluatedRules: ["transfers.max_usd_without_approval"],
				},
			}),
		);
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 100,
				recipientAddress: "denied-recipient",
				recipientKnown: false,
			},
		});

		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
	});

	it("preserves deterministic DENY even when LLM is enabled (DENY cannot loosen)", async () => {
		process.env.COMPASS_LLM_DECISION_ENABLED = "true";
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
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "blocked-recipient",
				recipientKnown: false,
			},
		});

		// Even with LLM enabled, DENY stays DENY because LLM is not fully configured
		// (no provider/model/apiKey), so the LLM is not consulted.
		expect(result.decision).toBe(COMPASS_DECISIONS.DENY);
	});

	it("keeps current behavior when LLM config is missing", async () => {
		delete process.env.COMPASS_LLM_DECISION_ENABLED;
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation(),
		);
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
			updated_at: "2026-06-07T00:00:00.000Z",
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
			},
		});

		expect(result.decision).toBe(COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL);
	});

	it("audit events include llmConsulted field when LLM is consulted", async () => {
		process.env.COMPASS_LLM_DECISION_ENABLED = "true";
		process.env.COMPASS_LLM_PROVIDER = "opencode-go";
		process.env.COMPASS_LLM_MODEL = "kimi-k2.5";
		process.env.COMPASS_LLM_BASE_URL = "https://opencode.ai/zen/go/v1/chat/completions";
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: vi.fn().mockResolvedValue({
				output_text: JSON.stringify({
					decision: "REQUIRE_HUMAN_APPROVAL",
					confidence: 0.92,
					reasonCodes: ["LLM_UNKNOWN_RECIPIENT"],
					rationale: "The recipient is unknown and needs approval.",
				}),
			}),
		} as unknown as Response);
		const transferGateway = await import("../transferGateway");
		vi.spyOn(transferGateway, "evaluateTransferGateway").mockResolvedValueOnce(
			mockTransferEvaluation(),
		);
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
			updated_at: "2026-06-07T00:00:00.000Z",
		});
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.GUARDED_TRANSFER_SOL,
			arguments: {
				network: "devnet",
				amountSol: 1,
				recipientAddress: "unknown-recipient",
				recipientKnown: false,
			},
		});

		const { listMcpAuditEvents } = await import("../mcp/mcpAuditSink");
		const events = listMcpAuditEvents();
		expect(events.some((event) => event.metadata.llmConsulted === true)).toBe(true);
		expect(events.at(-1)?.metadata).toMatchObject({
			llmConsulted: true,
			llmDecision: COMPASS_DECISIONS.REQUIRE_HUMAN_APPROVAL,
			llmClamped: false,
		});
	});

	it("denies devnet approval bypass when payload is not in pending store (arbitrary devnet payload)", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-arbitrary-payload",
				network: "devnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-arbitrary-payload")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain(
			"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE",
		);
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("allows devnet approval bypass when payload matches pending store from guarded_transfer_sol", async () => {
		const testKeypair = Keypair.generate();
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.COMPASS_LOCAL_SIGNER_SECRET_KEY_B58 = bs58.encode(
			testKeypair.secretKey,
		);
		process.env.COMPASS_LOCAL_SIGNER_PUBLIC_KEY = testKeypair.publicKey.toBase58();

		const sendRawTransaction = vi
			.spyOn(Connection.prototype, "sendRawTransaction")
			.mockResolvedValue("devnet-bypass-signature" as never);

		// Build a valid unsigned transaction whose fee payer matches the env keypair.
		const txMessage = new TransactionMessage({
			payerKey: testKeypair.publicKey,
			recentBlockhash: Keypair.generate().publicKey.toBase58(),
			instructions: [],
		}).compileToV0Message();
		const unsignedTx = new VersionedTransaction(txMessage);
		const unsignedB64 = Buffer.from(unsignedTx.serialize()).toString("base64");

		// Record the payload in the pending store — simulating what
		// guarded_transfer_sol would do when building a transactionPayload.
		const candidateId = "candidate-devnet-bypass-e2e";
		defaultPendingTransactionStore.record({
			candidateId,
			actionHash: APPROVED_ACTION_HASH,
			unsignedVersionedTransaction: unsignedB64,
			network: "devnet",
			tool: "guarded_transfer_sol",
			action: "transfer",
		});

		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId,
				network: "devnet",
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: unsignedB64,
				},
			},
		});

		expect(result).toMatchObject({
			ok: true,
			decision: COMPASS_DECISIONS.ALLOW,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			data: {
				candidateId,
				signerPath: "local_keypair",
				signature: "devnet-bypass-signature",
			},
		});
		expect(sendRawTransaction).toHaveBeenCalledTimes(1);
	});

	it("denies devnet approval bypass when stored payload does not match caller payload", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		// Pre-register a payload in the store with one transaction.
		const legitimatePayload = createUnsignedVersionedTransactionPayload();
		defaultPendingTransactionStore.record({
			candidateId: "candidate-mismatched-payload",
			actionHash: legitimatePayload.actionHash,
			unsignedVersionedTransaction: legitimatePayload.unsignedVersionedTransaction,
			network: "devnet",
			tool: "guarded_transfer_sol",
			action: "transfer",
		});

		// Now call execute_approved_action with a DIFFERENT transaction payload
		// but the same candidateId — this should be denied.
		const differentPayload = createUnsignedVersionedTransactionPayload(
			APPROVED_ACTION_HASH,
		);
		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-mismatched-payload",
				network: "devnet",
				transactionPayload: differentPayload,
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-mismatched-payload")).toBe(
			false,
		);
		expect(result).toMatchObject({
			ok: false,
			decision: COMPASS_DECISIONS.DENY,
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			riskClass: "SIGNING",
		});
		expect(result.reasonCodes).toContain(
			"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_COMPASS_BUILT",
		);
		expect(result.auditId).toEqual(expect.any(String));
	});

	it("does not consume idempotency on devnet bypass payload denial", async () => {
		const signerAdapter = await import("../signerAdapter");
		const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
		const { handleMcpToolCall } = await loadMcpToolCallRouter();
		const { MCP_TOOL_NAMES } = await loadMcpToolContracts();

		const result = await handleMcpToolCall({
			toolName: MCP_TOOL_NAMES.EXECUTE_APPROVED_ACTION,
			arguments: {
				candidateId: "candidate-no-store-entry",
				network: "devnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
			},
		});

		expect(signerSpy).not.toHaveBeenCalled();
		expect(defaultApprovalIdempotencyStore.has("candidate-no-store-entry")).toBe(
			false,
		);
		expect(result.reasonCodes).toContain(
			"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE",
		);
	});
});
