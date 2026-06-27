import { TransactionBuilder } from "@stellar/stellar-sdk";

import type { AccountSignerState } from "@shared/chainContracts";
import { COMPASS_DECISIONS } from "@shared/executionGatewayContracts";

import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import {
	createRealPrivyWalletClient,
	normalizeRawSignature,
	resolvePrivyStellarConfig,
	type PrivyWalletClient,
} from "./privyClient";
import {
	hashStellarEnvelope,
	inspectStellarAccount,
	type StellarCosignerDeps,
} from "./stellarCosigner";
import type {
	CompassStellarCosigner,
	CosignRefusalReason,
	CosignRequest,
	CosignResult,
} from "./stellarCosignerContracts";

export type PrivyStellarCosignerDeps = {
	env?: Record<string, string | undefined>;
	/** Injected Privy client for tests; real client built lazily otherwise. */
	client?: PrivyWalletClient;
	/** Injected Horizon account loader (Wave 4 inspectAccount). */
	loadAccount?: StellarCosignerDeps["loadAccount"];
};

type ResolvedPrivy =
	| {
			ok: true;
			client: PrivyWalletClient;
			walletId: string;
			walletPublicKey: string;
			authorizationPrivateKey?: string;
			passphrase: string;
	  }
	| { ok: false; reason: CosignRefusalReason };

function resolve(
	env: Record<string, string | undefined>,
	injectedClient?: PrivyWalletClient,
): ResolvedPrivy {
	let passphrase: string;
	try {
		passphrase = getStellarNetworkConfig(env).networkPassphrase;
	} catch (error) {
		if ((error as { code?: string }).code === "mainnet_forbidden") {
			return { ok: false, reason: "COMPASS_SIGNER_MAINNET_FORBIDDEN" };
		}
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}

	const config = resolvePrivyStellarConfig(env);
	if (!config) {
		return { ok: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" };
	}

	const client =
		injectedClient ??
		createRealPrivyWalletClient({
			appId: config.appId,
			appSecret: config.appSecret,
		});

	return {
		ok: true,
		client,
		walletId: config.walletId,
		walletPublicKey: config.walletPublicKey,
		authorizationPrivateKey: config.authorizationPrivateKey,
		passphrase,
	};
}

/**
 * Privy-custodied Stellar co-signer. Same gate/binding/guard as the Wave 4
 * local signer; the only difference is the signature comes from Privy raw-sign
 * (Ed25519 over tx.hash()) — Compass never holds the secret.
 */
export function createPrivyStellarCosigner(
	deps: PrivyStellarCosignerDeps = {},
): CompassStellarCosigner {
	const env = deps.env ?? process.env;

	return {
		getPublicKey(): string | null {
			const resolved = resolve(env, deps.client);
			return resolved.ok ? resolved.walletPublicKey : null;
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

			const resolved = resolve(env, deps.client);
			if (!resolved.ok) {
				const failure = resolved as { reason: CosignRefusalReason };
				return { signed: false, reason: failure.reason };
			}

			try {
				const tx = TransactionBuilder.fromXDR(
					request.envelopeXdr,
					resolved.passphrase,
				);
				const hashHex = `0x${tx.hash().toString("hex")}`;
				const response = await resolved.client.rawSign(resolved.walletId, {
					params: { hash: hashHex },
					...(resolved.authorizationPrivateKey
						? {
								authorization_context: {
									authorization_private_keys: [
										resolved.authorizationPrivateKey,
									],
								},
							}
						: {}),
				});
				const signatureB64 = normalizeRawSignature(response);
				// SDK validates the signature against tx.hash() + the public key.
				tx.addSignature(resolved.walletPublicKey, signatureB64);
				return {
					signed: true,
					signedXdr: tx.toXDR(),
					signerPublicKey: resolved.walletPublicKey,
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
			return inspectStellarAccount(address, { loadAccount: deps.loadAccount });
		},
	};
}
