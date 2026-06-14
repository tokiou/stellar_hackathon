import { VersionedTransaction } from "@solana/web3.js";

import { defaultApprovalIdempotencyStore } from "../approvalIdempotencyStore";
import {
	buildAuditEvent,
	classifyToolCall,
	createActionCandidate,
} from "../executionGateway";
import { COMPASS_DECISIONS } from "../executionGatewayContracts";
import * as onchainApproval from "../onchainApproval";
import { defaultPendingTransactionStore } from "../pendingTransactionStore";
import { createSignerAdapter } from "../signerAdapter";
import { recordMcpAuditEvent } from "./mcpAuditSink";
import type {
	ExecuteMcpTransferInput as ExecuteMcpTransferContractInput,
	McpSupportedNetwork,
} from "./mcpToolContracts";

/**
 * Result of internal transfer execution.
 */
export type ExecuteMcpTransferResult = {
	ok: boolean;
	signature?: string;
	reasonCodes?: string[];
	auditId: string;
	signerPath?: string;
	candidateId?: string;
	devnetApprovalBypassed?: boolean;
};

/**
 * Input for the internal E2E transfer executor.
 * Extracted from the handleExecuteApprovedActionTool logic so that
 * compass_transfer can reuse the same execution path.
 */
export type ExecuteInternalMcpTransferInput = ExecuteMcpTransferContractInput & {
	/** Audit context */
	toolName: string;
	actionKind: string;
	classification: ReturnType<typeof classifyToolCall>;
	riskClass: string;
};

const MCP_AUDIT_ACTION_KIND_PREFIX = "mcp_tool_call";

function networkToRpcUrl(network: string): string {
	if (network === "mainnet-beta") {
		return "https://api.mainnet-beta.solana.com";
	}
	if (network === "testnet") {
		return "https://api.testnet.solana.com";
	}
	return "https://api.devnet.solana.com";
}

function emitMcpAudit(input: {
	publicToolName: string;
	actionKind: string;
	classification: ReturnType<typeof classifyToolCall>;
	decision: typeof COMPASS_DECISIONS[keyof typeof COMPASS_DECISIONS];
	result: "pending" | "success" | "failed" | "denied";
	metadata?: Record<string, unknown>;
	network?: string;
}): string {
	const candidate = createActionCandidate({
		chain: "solana",
		network: input.network ?? "devnet",
		toolName: input.publicToolName,
		actionKind: `${MCP_AUDIT_ACTION_KIND_PREFIX}.${input.actionKind}`,
		params: {},
	});
	const event = buildAuditEvent({
		candidate,
		classification: {
			...input.classification,
			toolName: input.publicToolName,
		},
		decision: input.decision,
		result: input.result,
		metadata: input.metadata,
	});
	return recordMcpAuditEvent(event);
}

/**
 * Validate that a devnet approval-bypass payload matches a transaction
 * built by Compass in a prior guarded call.
 */
function validateDevnetBypassPayload(input: {
	candidateId: string;
	network: McpSupportedNetwork;
	transactionPayload: ExecuteMcpTransferContractInput["transactionPayload"];
}): { ok: true } | { ok: false; reason: string } {
	if (input.network !== "devnet") {
		return { ok: false, reason: "DEVNET_APPROVAL_BYPASS_NETWORK_NOT_DEVNET" };
	}

	const payloadActionHash = normalizeActionHash(input.transactionPayload.actionHash);
	const stored = payloadActionHash
		? defaultPendingTransactionStore.consumeByCandidateId(input.candidateId) ??
			defaultPendingTransactionStore.consumeByActionHash(payloadActionHash)
		: defaultPendingTransactionStore.consumeByCandidateId(input.candidateId);

	if (!stored) {
		return { ok: false, reason: "DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_IN_STORE" };
	}

	if (stored.network !== input.network) {
		return { ok: false, reason: "DEVNET_APPROVAL_BYPASS_NETWORK_MISMATCH" };
	}

	if (
		stored.unsignedVersionedTransaction !==
		input.transactionPayload.unsignedVersionedTransaction
	) {
		return { ok: false, reason: "DEVNET_APPROVAL_BYPASS_PAYLOAD_NOT_COMPASS_BUILT" };
	}

	return { ok: true };
}

function normalizeActionHash(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

/**
 * Execute an MCP transfer internally.
 *
 * Handles devnet bypass validation, on-chain approval proof verification,
 * idempotency consumption, signer creation, transaction signing, and audit.
 * This is the shared execution path used by both compass_transfer E2E flow
 * and the internal-only execute_approved_action handler.
 */
export async function executeMcpTransfer(
	input: ExecuteInternalMcpTransferInput,
): Promise<ExecuteMcpTransferResult> {
	let devnetApprovalBypassed = false;

	// 1. Validate approval: either on-chain proof or devnet bypass
	if (input.approvalProof) {
		const approval = await onchainApproval.verifyActionApproval(
			input.approvalProof,
		);
		if (!approval.ok) {
			const auditId = emitMcpAudit({
				publicToolName: input.toolName,
				actionKind: input.actionKind,
				classification: input.classification,
				decision: COMPASS_DECISIONS.DENY,
				result: "denied",
				network: input.network,
				metadata: {
					registeredTool: true,
					candidateId: input.candidateId,
					duplicateBlocked: false,
					approvalVerified: false,
					devnetApprovalBypassed: false,
					signerPath: "not_reached",
				},
			});
			return {
				ok: false,
				reasonCodes: [approval.reason ?? "ONCHAIN_ACTION_APPROVAL_INVALID"],
				auditId,
				candidateId: input.candidateId,
				signerPath: "not_reached",
			};
		}
	} else {
		// Devnet bypass: payload must match Compass-built entry in pending store
		const devnetGuard = validateDevnetBypassPayload({
			candidateId: input.candidateId,
			network: input.network,
			transactionPayload: input.transactionPayload,
		});
		if (devnetGuard.ok === false) {
			const auditId = emitMcpAudit({
				publicToolName: input.toolName,
				actionKind: input.actionKind,
				classification: input.classification,
				decision: COMPASS_DECISIONS.DENY,
				result: "denied",
				network: input.network,
				metadata: {
					registeredTool: true,
					candidateId: input.candidateId,
					duplicateBlocked: false,
					approvalVerified: false,
					devnetApprovalBypassed: false,
					devnetPayloadGuardReason: devnetGuard.reason,
					signerPath: "not_reached",
				},
			});
			return {
				ok: false,
				reasonCodes: [devnetGuard.reason],
				auditId,
				candidateId: input.candidateId,
				signerPath: "not_reached",
			};
		}
		devnetApprovalBypassed = true;
	}

	// 2. Deserialize the unsigned transaction
	let unsignedTx: VersionedTransaction;
	try {
		unsignedTx = VersionedTransaction.deserialize(
			Buffer.from(input.transactionPayload.unsignedVersionedTransaction, "base64"),
		);
	} catch {
		const auditId = emitMcpAudit({
			publicToolName: input.toolName,
			actionKind: input.actionKind,
			classification: input.classification,
			decision: COMPASS_DECISIONS.REQUIRE_ADDITIONAL_CONTEXT,
			result: "failed",
			network: input.network,
			metadata: {
				registeredTool: true,
				candidateId: input.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
				validationErrors: ["INVALID_TRANSACTION_PAYLOAD"],
			},
		});
		return {
			ok: false,
			reasonCodes: ["INVALID_TRANSACTION_PAYLOAD"],
			auditId,
			candidateId: input.candidateId,
			signerPath: "not_reached",
		};
	}

	// 3. Create signer adapter
	const signer = createSignerAdapter({ rpcUrl: networkToRpcUrl(input.network) });
	if (signer.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: input.toolName,
			actionKind: input.actionKind,
			classification: input.classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: input.network,
			metadata: {
				registeredTool: true,
				candidateId: input.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
			},
		});
		return {
			ok: false,
			reasonCodes: [signer.reason],
			auditId,
			candidateId: input.candidateId,
			signerPath: "not_reached",
		};
	}

	if (!signer.adapter.signAndSendTransaction) {
		const auditId = emitMcpAudit({
			publicToolName: input.toolName,
			actionKind: input.actionKind,
			classification: input.classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: input.network,
			metadata: {
				registeredTool: true,
				candidateId: input.candidateId,
				duplicateBlocked: false,
				approvalVerified: true,
				devnetApprovalBypassed,
				signerPath: "not_reached",
			},
		});
		return {
			ok: false,
			reasonCodes: ["LOCAL_SIGNER_NOT_CONFIGURED"],
			auditId,
			candidateId: input.candidateId,
			signerPath: "not_reached",
		};
	}

	// 4. Consume idempotency RIGHT BEFORE signing (not after building)
	const consumed = defaultApprovalIdempotencyStore.consume(input.candidateId);
	if (consumed.ok === false) {
		const auditId = emitMcpAudit({
			publicToolName: input.toolName,
			actionKind: input.actionKind,
			classification: input.classification,
			decision: COMPASS_DECISIONS.DENY,
			result: "denied",
			network: input.network,
			metadata: {
				registeredTool: true,
				candidateId: input.candidateId,
				duplicateBlocked: true,
				approvalVerified: true,
				signerPath: "not_reached",
			},
		});
		return {
			ok: false,
			reasonCodes: [consumed.reason],
			auditId,
			candidateId: input.candidateId,
			signerPath: "not_reached",
		};
	}

	// 5. Sign and send transaction
	const signature = await signer.adapter.signAndSendTransaction(unsignedTx);
	const auditId = emitMcpAudit({
		publicToolName: input.toolName,
		actionKind: input.actionKind,
		classification: input.classification,
		decision: COMPASS_DECISIONS.ALLOW,
		result: "success",
		network: input.network,
		metadata: {
			registeredTool: true,
			candidateId: input.candidateId,
			duplicateBlocked: false,
			approvalVerified: true,
			devnetApprovalBypassed,
			signerPath: "local_keypair",
			transactionSubmitted: true,
			signature,
		},
	});

	return {
		ok: true,
		signature,
		auditId,
		signerPath: "local_keypair",
		candidateId: input.candidateId,
		devnetApprovalBypassed,
	};
}
