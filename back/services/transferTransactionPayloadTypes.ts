import type { ExecuteApprovedActionTransactionPayload } from "./mcp/mcpToolContracts";

export type BuildSolTransferTransactionPayloadInput = {
	candidateId: string;
	network: string;
	sourceWallet: string;
	recipientAddress: string;
	amountSol: number;
	rpcUrl: string;
};

export type BuildSolTransferTransactionPayloadResult =
	| {
			ok: true;
			payload: ExecuteApprovedActionTransactionPayload;
			lamports: number;
			sourceWallet: string;
			recipientAddress: string;
	  }
	| {
			ok: false;
			reason:
				| "TRANSFER_PAYLOAD_UNSUPPORTED_NETWORK"
				| "TRANSFER_PAYLOAD_INVALID_AMOUNT"
				| "TRANSFER_PAYLOAD_INVALID_WALLET"
				| "TRANSFER_PAYLOAD_BUILD_FAILED";
	  };
