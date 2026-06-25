import type { AccountSignerState } from "@shared/chainContracts";
import type { CompassDecision } from "@shared/executionGatewayContracts";

/**
 * Stellar co-signing contract (Stellar Wave 4).
 *
 * Operates on a base64 `TransactionEnvelope` XDR string — deliberately NOT
 * typed on Solana's `VersionedTransaction`. Compass is an ADDITIONAL signer on
 * a multisig account: it adds only its own signature, only when the brain
 * decided ALLOW, and never submits. If Compass does not sign, the account's
 * threshold is unmet and the network rejects the transaction.
 */

export type CosignRequest = {
	/** base64 TransactionEnvelope XDR (may already carry the user's signature). */
	envelopeXdr: string;
	/** The brain's decision for this exact envelope. */
	decision: CompassDecision;
	/** Optional binding: the candidate fingerprint Compass evaluated. */
	expectedEnvelopeFingerprint?: string;
};

export type CosignRefusalReason =
	| "POLICY_NOT_ALLOWED"
	| "COMPASS_SIGNER_NOT_CONFIGURED"
	| "COMPASS_SIGNER_MAINNET_FORBIDDEN"
	| "ENVELOPE_CANDIDATE_MISMATCH"
	| "COSIGN_FAILED";

export type CosignResult =
	| {
			signed: true;
			signedXdr: string;
			signerPublicKey: string;
			envelopeFingerprint: string;
	  }
	| { signed: false; reason: CosignRefusalReason; message?: string };

export interface CompassStellarCosigner {
	/** Compass's public signer key, or null when not configured. Never the secret. */
	getPublicKey(): string | null;
	cosign(request: CosignRequest): Promise<CosignResult>;
	inspectAccount(address: string): Promise<AccountSignerState>;
}
