import type { CompassStellarCosigner } from "./stellarCosignerContracts";
import { createStellarCosigner, type StellarCosignerDeps } from "./stellarCosigner";
import {
	createPrivyStellarCosigner,
	type PrivyStellarCosignerDeps,
} from "./privyStellarCosigner";

export type StellarSignerProvider = "local" | "privy";

export type ResolveStellarCosignerDeps = StellarCosignerDeps &
	Pick<PrivyStellarCosignerDeps, "client">;

/**
 * Privy is MANDATORY for Compass's Stellar co-signing.
 *
 * The co-signer key must be custodied by Privy — Compass never holds a raw
 * seed. The default provider is `privy`. The legacy `local` raw-seed signer is
 * disabled and only available behind an explicit dev escape hatch
 * (`COMPASS_ALLOW_LOCAL_SIGNER=true`); otherwise selecting it throws, surfacing
 * the misconfiguration immediately instead of silently signing with a local key.
 */
export function resolveStellarCosigner(
	env: Record<string, string | undefined> = process.env,
	deps: ResolveStellarCosignerDeps = {},
): CompassStellarCosigner {
	const provider = (env.COMPASS_STELLAR_SIGNER_PROVIDER ?? "privy").trim();

	if (provider === "local") {
		if (env.COMPASS_ALLOW_LOCAL_SIGNER !== "true") {
			throw new Error(
				"PRIVY_REQUIRED: the local raw-seed signer is disabled. Use COMPASS_STELLAR_SIGNER_PROVIDER=privy (Privy custodies Compass's key). For dev only, set COMPASS_ALLOW_LOCAL_SIGNER=true.",
			);
		}
		return createStellarCosigner({ env, loadAccount: deps.loadAccount });
	}

	if (provider !== "privy") {
		throw new Error(
			`PRIVY_REQUIRED: unsupported signer provider "${provider}". Privy is mandatory (COMPASS_STELLAR_SIGNER_PROVIDER=privy).`,
		);
	}

	return createPrivyStellarCosigner({
		env,
		client: deps.client,
		loadAccount: deps.loadAccount,
	});
}
