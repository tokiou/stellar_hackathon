import { createHash } from "node:crypto";

import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import type { AccountSignerState } from "@shared/chainContracts";
import { COMPASS_DECISIONS } from "@shared/executionGatewayContracts";

import { getHorizonServer } from "../providers/stellarConnection";
import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import type {
	CompassStellarCosigner,
	CosignRefusalReason,
	CosignRequest,
	CosignResult,
} from "./stellarCosignerContracts";

/** Deterministic fingerprint of an envelope, for candidate binding. */
export function hashStellarEnvelope(envelopeXdr: string): string {
	return createHash("sha256").update(envelopeXdr).digest("hex");
}

type StellarAccountRecord = {
	signers: Array<{ key: string; weight: number; type?: string }>;
	thresholds: {
		low_threshold: number;
		med_threshold: number;
		high_threshold: number;
	};
};

type AccountLoader = (address: string) => Promise<StellarAccountRecord>;

export type StellarCosignerDeps = {
	env?: Record<string, string | undefined>;
	loadAccount?: AccountLoader;
};

type ResolveKeypairResult =
	| { ok: true; keypair: Keypair; passphrase: string }
	| { ok: false; reason: CosignRefusalReason };

function resolveCompassKeypair(
	env: Record<string, string | undefined>,
): ResolveKeypairResult {
	if (env.COMPASS_STELLAR_SIGNER_ENABLED !== "true") {
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}
	const secret = env.COMPASS_STELLAR_SIGNER_SECRET?.trim();
	if (!secret) {
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}

	let passphrase: string;
	try {
		passphrase = getStellarNetworkConfig(env).networkPassphrase;
	} catch (error) {
		if ((error as { code?: string }).code === "mainnet_forbidden") {
			return { ok: false, reason: "COMPASS_SIGNER_MAINNET_FORBIDDEN" };
		}
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}

	let keypair: Keypair;
	try {
		keypair = Keypair.fromSecret(secret);
	} catch {
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}
	return { ok: true, keypair, passphrase };
}

/**
 * Reads an account's classic-multisig configuration from Horizon. Returns the
 * neutral Wave 0 `AccountSignerState`. Uses the medium threshold (the one that
 * gates payments). Injectable loader keeps it testable offline.
 */
export async function inspectStellarAccount(
	address: string,
	deps: StellarCosignerDeps = {},
): Promise<AccountSignerState> {
	const loadAccount: AccountLoader =
		deps.loadAccount ??
		(async (addr) => {
			const record = await getHorizonServer().loadAccount(addr);
			return {
				signers: record.signers,
				thresholds: record.thresholds,
			} as StellarAccountRecord;
		});

	try {
		const record = await loadAccount(address);
		return {
			address,
			exists: true,
			signers: record.signers.map((signer) => signer.key),
			threshold: record.thresholds?.med_threshold,
		};
	} catch {
		return { address, exists: false };
	}
}

/**
 * Whether the collected signatures meet the account threshold. The demo
 * multisig uses weight-1 signers, so "weight met" reduces to
 * `collectedSignatures >= threshold`.
 */
export function meetsThreshold(
	collectedSignatures: number,
	threshold: number | undefined,
): boolean {
	if (typeof threshold !== "number") {
		return false;
	}
	return collectedSignatures >= threshold;
}

export function createStellarCosigner(
	deps: StellarCosignerDeps = {},
): CompassStellarCosigner {
	const env = deps.env ?? process.env;

	return {
		getPublicKey(): string | null {
			const resolved = resolveCompassKeypair(env);
			return resolved.ok ? resolved.keypair.publicKey() : null;
		},

		async cosign(request: CosignRequest): Promise<CosignResult> {
			if (request.decision !== COMPASS_DECISIONS.ALLOW) {
				return { signed: false, reason: "POLICY_NOT_ALLOWED" };
			}

			const fingerprint = hashStellarEnvelope(request.envelopeXdr);
			if (
				request.expectedEnvelopeFingerprint &&
				request.expectedEnvelopeFingerprint !== fingerprint
			) {
				return { signed: false, reason: "ENVELOPE_CANDIDATE_MISMATCH" };
			}

			const resolved = resolveCompassKeypair(env);
			if (!resolved.ok) {
				// strict:false disables ok:false narrowing in this repo; cast the variant.
				const failure = resolved as { reason: CosignRefusalReason };
				return { signed: false, reason: failure.reason };
			}

			try {
				const tx = TransactionBuilder.fromXDR(
					request.envelopeXdr,
					resolved.passphrase,
				);
				tx.sign(resolved.keypair);
				return {
					signed: true,
					signedXdr: tx.toXDR(),
					signerPublicKey: resolved.keypair.publicKey(),
					envelopeFingerprint: fingerprint,
				};
			} catch (error) {
				return {
					signed: false,
					reason: "COSIGN_FAILED",
					message: (error as Error).message,
				};
			}
		},

		async inspectAccount(address: string): Promise<AccountSignerState> {
			return inspectStellarAccount(address, deps);
		},
	};
}
