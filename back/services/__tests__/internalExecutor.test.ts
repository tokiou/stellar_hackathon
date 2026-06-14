import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultApprovalIdempotencyStore } from "../approvalIdempotencyStore";
import { resetMcpAuditEvents } from "../mcp/mcpAuditSink";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";

const APPROVED_ACTION_HASH = "ab".repeat(32);

function createUnsignedVersionedTransactionPayload(actionHash = APPROVED_ACTION_HASH) {
	const payer = Keypair.generate();
	const message = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: Keypair.generate().publicKey.toBase58(),
		instructions: [],
	}).compileToV0Message();
	const tx = new VersionedTransaction(message);

	return {
		encoding: "base64" as const,
		actionHash,
		unsignedVersionedTransaction: Buffer.from(tx.serialize()).toString("base64"),
	};
}

function createApprovalProof(actionHash = APPROVED_ACTION_HASH) {
	return {
		execute_tx_signature: "proof-signature",
		expected_network: "devnet" as const,
		action_hash: actionHash,
		user: "approved-user",
	};
}

function mockSignerAdapter(sendMock: ReturnType<typeof vi.fn>) {
	const signerAdapter = vi.fn().mockReturnValue({
		ok: true,
		adapter: {
			getAddress: vi.fn().mockResolvedValue("mock-signer-address"),
			signTransaction: vi.fn(),
			signAndSendTransaction: sendMock,
		},
	});
	return signerAdapter;
}

async function loadInternalExecutor() {
	return import("../mcp/internalExecutor");
}

describe("internalExecutor", () => {
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

	describe("executeMcpTransfer", () => {
		it("returns ok with signature on successful devnet bypass execution", async () => {
			const sendMock = vi.fn().mockResolvedValue("devnet-e2e-signature");
			const signerAdapter = await import("../signerAdapter");
			vi.spyOn(signerAdapter, "createSignerAdapter").mockImplementation(
				mockSignerAdapter(sendMock) as never,
			);
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const transactionPayload = createUnsignedVersionedTransactionPayload();
			defaultPendingTransactionStore.record({
				candidateId: "candidate-devnet-e2e",
				actionHash: APPROVED_ACTION_HASH,
				unsignedVersionedTransaction:
					transactionPayload.unsignedVersionedTransaction,
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-devnet-e2e",
				network: "devnet",
				transactionPayload,
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(true);
			expect(result.signature).toBe("devnet-e2e-signature");
			expect(result.auditId).toEqual(expect.any(String));
			expect(result.signerPath).toBe("local_keypair");
			expect(sendMock).toHaveBeenCalledTimes(1);
		});

		it("consumes idempotency right before signing, blocking duplicate execution", async () => {
			const sendMock = vi.fn().mockResolvedValue("idempotency-sig");
			const signerAdapter = await import("../signerAdapter");
			vi.spyOn(signerAdapter, "createSignerAdapter").mockImplementation(
				mockSignerAdapter(sendMock) as never,
			);
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const transactionPayload = createUnsignedVersionedTransactionPayload();
			defaultPendingTransactionStore.record({
				candidateId: "candidate-idempotency-test",
				actionHash: APPROVED_ACTION_HASH,
				unsignedVersionedTransaction:
					transactionPayload.unsignedVersionedTransaction,
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			// First call: should succeed and consume idempotency
			const result1 = await executeMcpTransfer({
				candidateId: "candidate-idempotency-test",
				network: "devnet",
				transactionPayload,
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result1.ok).toBe(true);
			expect(result1.signature).toBe("idempotency-sig");

			// Re-record in pending store for second call attempt
			defaultPendingTransactionStore.record({
				candidateId: "candidate-idempotency-test",
				actionHash: APPROVED_ACTION_HASH,
				unsignedVersionedTransaction:
					transactionPayload.unsignedVersionedTransaction,
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			// Second call with same candidateId: blocked as duplicate
			const result2 = await executeMcpTransfer({
				candidateId: "candidate-idempotency-test",
				network: "devnet",
				transactionPayload,
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result2.ok).toBe(false);
			expect(result2.reasonCodes).toContain("DUPLICATE_APPROVAL_EXECUTION");
			// Only one call to signAndSendTransaction — the duplicate was blocked before signing
			expect(sendMock).toHaveBeenCalledTimes(1);
		});

		it("rejects devnet bypass when payload is not in pending store (not Compass-built)", async () => {
			const signerAdapter = await import("../signerAdapter");
			const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-not-in-store",
				network: "devnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(false);
			expect(result.reasonCodes).toContain(
				"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE",
			);
			expect(signerSpy).not.toHaveBeenCalled();
		});

		it("rejects devnet bypass when stored payload does not match caller payload", async () => {
			const signerAdapter = await import("../signerAdapter");
			const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const legitimatePayload = createUnsignedVersionedTransactionPayload();
			defaultPendingTransactionStore.record({
				candidateId: "candidate-mismatch-e2e",
				actionHash: legitimatePayload.actionHash,
				unsignedVersionedTransaction:
					legitimatePayload.unsignedVersionedTransaction,
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			const differentPayload = createUnsignedVersionedTransactionPayload(
				APPROVED_ACTION_HASH,
			);

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-mismatch-e2e",
				network: "devnet",
				transactionPayload: differentPayload,
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(false);
			expect(result.reasonCodes).toContain(
				"DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_COMPASS_BUILT",
			);
			expect(signerSpy).not.toHaveBeenCalled();
		});

		it("verifies on-chain approval proof for non-devnet execution", async () => {
			const onchainApproval = await import("../onchainApproval");
			vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
				ok: true,
			});
			const sendMock = vi.fn().mockResolvedValue("testnet-signature");
			const signerAdapter = await import("../signerAdapter");
			vi.spyOn(signerAdapter, "createSignerAdapter").mockImplementation(
				mockSignerAdapter(sendMock) as never,
			);
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-testnet-proof",
				network: "testnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
				approvalProof: createApprovalProof(),
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(onchainApproval.verifyActionApproval).toHaveBeenCalledWith(
				createApprovalProof(),
			);
			expect(result.ok).toBe(true);
			expect(result.signature).toBe("testnet-signature");
		});

		it("denies execution when on-chain approval proof verification fails", async () => {
			const onchainApproval = await import("../onchainApproval");
			vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
				ok: false,
				reason: "ONCHAIN_ACTION_APPROVAL_INVALID",
			});
			const signerAdapter = await import("../signerAdapter");
			const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-failed-proof",
				network: "testnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
				approvalProof: createApprovalProof(),
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(false);
			expect(result.reasonCodes).toContain("ONCHAIN_ACTION_APPROVAL_INVALID");
			expect(signerSpy).not.toHaveBeenCalled();
		});

		it("returns signer not configured error when local signer is unavailable", async () => {
			delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;
			const signerAdapter = await import("../signerAdapter");
			const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter").mockReturnValue({
				ok: false,
				reason: "LOCAL_SIGNER_NOT_CONFIGURED",
			} as never);
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			// Non-devnet with approval proof: will pass proof verification, then hit signer check
			const onchainApproval = await import("../onchainApproval");
			vi.spyOn(onchainApproval, "verifyActionApproval").mockResolvedValueOnce({
				ok: true,
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-no-signer",
				network: "testnet",
				transactionPayload: createUnsignedVersionedTransactionPayload(),
				approvalProof: createApprovalProof(),
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(false);
			expect(result.reasonCodes).toContain("LOCAL_SIGNER_NOT_CONFIGURED");
			expect(signerSpy).toHaveBeenCalled();
		});

		it("returns invalid transaction payload error for bad base64 data", async () => {
			const signerAdapter = await import("../signerAdapter");
			const signerSpy = vi.spyOn(signerAdapter, "createSignerAdapter");
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			defaultPendingTransactionStore.record({
				candidateId: "candidate-bad-payload",
				actionHash: APPROVED_ACTION_HASH,
				unsignedVersionedTransaction: Buffer.from("not-a-valid-tx").toString("base64"),
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-bad-payload",
				network: "devnet",
				transactionPayload: {
					encoding: "base64",
					actionHash: APPROVED_ACTION_HASH,
					unsignedVersionedTransaction: Buffer.from("not-a-valid-tx").toString("base64"),
				},
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(false);
			expect(result.reasonCodes).toContain("INVALID_TRANSACTION_PAYLOAD");
			// Should not even try to create signer for invalid payload
			expect(signerSpy).not.toHaveBeenCalled();
		});

		it("returns success with devnetApprovalBypassed flag for devnet bypass execution", async () => {
			const sendMock = vi.fn().mockResolvedValue("devnet-bypass-flag-sig");
			const signerAdapter = await import("../signerAdapter");
			vi.spyOn(signerAdapter, "createSignerAdapter").mockImplementation(
				mockSignerAdapter(sendMock) as never,
			);
			const { classifyToolCall } = await import("../executionGateway");
			const classification = classifyToolCall({
				toolName: "transfer",
				mutates: true,
			});

			const transactionPayload = createUnsignedVersionedTransactionPayload();
			defaultPendingTransactionStore.record({
				candidateId: "candidate-devnet-flag",
				actionHash: APPROVED_ACTION_HASH,
				unsignedVersionedTransaction:
					transactionPayload.unsignedVersionedTransaction,
				network: "devnet",
				tool: "compass_transfer",
				action: "transfer",
			});

			const { executeMcpTransfer } = await loadInternalExecutor();

			const result = await executeMcpTransfer({
				candidateId: "candidate-devnet-flag",
				network: "devnet",
				transactionPayload,
				toolName: "compass_transfer",
				actionKind: "transfer",
				classification,
				riskClass: "SENSITIVE_EXECUTION",
			});

			expect(result.ok).toBe(true);
			expect(result.devnetApprovalBypassed).toBe(true);
		});
	});
});