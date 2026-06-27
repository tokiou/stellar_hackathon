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
 * Selects the Stellar co-signer implementation by
 * COMPASS_STELLAR_SIGNER_PROVIDER. Defaults to the Wave 4 local-keypair signer
 * so existing behavior is unchanged; `privy` uses the Privy-custodied signer.
 */
export function resolveStellarCosigner(
	env: Record<string, string | undefined> = process.env,
	deps: ResolveStellarCosignerDeps = {},
): CompassStellarCosigner {
	const provider = (env.COMPASS_STELLAR_SIGNER_PROVIDER ?? "local").trim();
	if (provider === "privy") {
		return createPrivyStellarCosigner({
			env,
			client: deps.client,
			loadAccount: deps.loadAccount,
		});
	}
	return createStellarCosigner({ env, loadAccount: deps.loadAccount });
}
