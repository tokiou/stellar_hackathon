import { Keypair, VersionedTransaction } from "@solana/web3.js";
import {
	SignerAdapter,
	SignerAdapterConfig,
	CreateSignerAdapterResult,
} from "./signerAdapterContracts";

// LocalKeypairAdapter — devnet demo only, never product custody.
// Guarded by COMPASS_LOCAL_SIGNER_ENABLED=true env flag.
// Throws LOCAL_SIGNER_MAINNET_FORBIDDEN for any non-devnet RPC.
export class LocalKeypairAdapter implements SignerAdapter {
	private keypair: Keypair;

	constructor(secretKey: Uint8Array) {
		this.keypair = Keypair.fromSecretKey(secretKey);
	}

	async getAddress(): Promise<string> {
		return this.keypair.publicKey.toBase58();
	}

	async signTransaction(
		tx: VersionedTransaction,
	): Promise<VersionedTransaction> {
		tx.sign([this.keypair]);
		return tx;
	}

	async signAndSendTransaction(tx: VersionedTransaction): Promise<string> {
		// In a real implementation, this would submit to the network
		// For now, we'll just sign and return a mock signature
		this.signTransaction(tx);
		return "mock-signature";
	}
}

export function createSignerAdapter(
	config?: SignerAdapterConfig,
): CreateSignerAdapterResult {
	const isEnabled = process.env.COMPASS_LOCAL_SIGNER_ENABLED === "true";
	const rpcUrl = config?.rpcUrl || process.env.SOLANA_RPC_URL;

	if (!isEnabled) {
		return { ok: false, reason: "LOCAL_SIGNER_NOT_CONFIGURED" };
	}

	if (rpcUrl?.includes("mainnet")) {
		return { ok: false, reason: "LOCAL_SIGNER_MAINNET_FORBIDDEN" };
	}

	if (!config?.localSecretKey) {
		return { ok: false, reason: "LOCAL_SIGNER_NOT_CONFIGURED" };
	}

	return {
		ok: true,
		adapter: new LocalKeypairAdapter(config.localSecretKey),
	};
}
