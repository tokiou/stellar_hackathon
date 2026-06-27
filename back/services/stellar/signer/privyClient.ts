/**
 * Privy server-wallet client surface used by the Stellar co-signer.
 *
 * We type only the slice we use (`rawSign`) structurally, so the adapter is
 * unit-testable with an injected fake and does not hard-depend on
 * `@privy-io/node` at test time. The lazy factory builds the real client at
 * runtime from app credentials.
 */

export interface PrivyCreatedWallet {
	id: string;
	address?: string; // Stellar G… address (preferred)
	public_key?: string; // raw ed25519 hex (fallback to derive the address)
}

export type PrivyAuthorizationContext = {
	authorization_private_keys: string[];
};

export interface PrivyRawSignInput {
	params: { hash: string };
	authorization_context?: PrivyAuthorizationContext;
}

export interface PrivyCreateInput {
	chain_type: string;
	user_id?: string;
	owner?: { public_key: string };
}

export interface PrivyWalletClient {
	/** Returns a 64-byte Ed25519 signature for a 0x-hex hash. */
	rawSign(
		walletId: string,
		input: PrivyRawSignInput,
	): Promise<{ signature: string } | string>;
	/** Provisions a new server wallet (onboarding). Optional on the interface. */
	create?(input: PrivyCreateInput): Promise<PrivyCreatedWallet>;
}

export type PrivyStellarConfig = {
	appId: string;
	appSecret: string; // secret — never logged or returned
	walletId: string;
	walletPublicKey: string; // Stellar G… address (public)
	/** base64 PKCS8 P-256 authorization private key (required to authorize rawSign). */
	authorizationPrivateKey?: string;
};

/**
 * Builds the real Privy client lazily. The `@privy-io/node` import is dynamic
 * so tests (which inject a fake client) never load the package, and the real
 * client is only constructed when an actual signing call is made.
 */
export function createRealPrivyWalletClient(
	config: Pick<PrivyStellarConfig, "appId" | "appSecret">,
): PrivyWalletClient {
	let walletsPromise: Promise<{
		rawSign: PrivyWalletClient["rawSign"];
	}> | null = null;

	const getWallets = () => {
		if (!walletsPromise) {
			walletsPromise = import("@privy-io/node").then(({ PrivyClient }) => {
				const privy = new PrivyClient({
					appId: config.appId,
					appSecret: config.appSecret,
				});
				return privy.wallets() as { rawSign: PrivyWalletClient["rawSign"] };
			});
		}
		return walletsPromise;
	};

	return {
		async rawSign(walletId, input) {
			const wallets = await getWallets();
			return wallets.rawSign(walletId, input);
		},
		async create(input) {
			const wallets = (await getWallets()) as unknown as {
				create: (i: PrivyCreateInput) => Promise<PrivyCreatedWallet>;
			};
			return wallets.create(input);
		},
	};
}

/** Resolves the Privy config from env, or null when any required field is missing. */
export function resolvePrivyStellarConfig(
	env: Record<string, string | undefined>,
): PrivyStellarConfig | null {
	const appId = env.PRIVY_APP_ID?.trim();
	const appSecret = env.PRIVY_APP_SECRET?.trim();
	const walletId = env.COMPASS_STELLAR_PRIVY_WALLET_ID?.trim();
	const walletPublicKey = env.COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY?.trim();
	const authorizationPrivateKey = env.PRIVY_AUTHORIZATION_KEY?.trim();
	if (!appId || !appSecret || !walletId || !walletPublicKey) {
		return null;
	}
	return { appId, appSecret, walletId, walletPublicKey, authorizationPrivateKey };
}

/** Normalizes a Privy raw-sign response to a base64 signature for the Stellar SDK. */
export function normalizeRawSignature(
	response: { signature: string } | string,
): string {
	const raw = typeof response === "string" ? response : response.signature;
	const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
	// Privy returns hex; convert to base64 for tx.addSignature.
	return Buffer.from(hex, "hex").toString("base64");
}
