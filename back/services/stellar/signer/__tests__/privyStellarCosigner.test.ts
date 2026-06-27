import { readFileSync } from "node:fs";
import path from "node:path";

import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { COMPASS_DECISIONS } from "@shared/executionGatewayContracts";
import { describe, expect, it, vi } from "vitest";

import type { PrivyWalletClient } from "../privyClient";
import { createPrivyStellarCosigner } from "../privyStellarCosigner";
import { resolveStellarCosigner } from "../stellarCosignerFactory";

const USER = Keypair.random();
// The Privy "server wallet": in tests we hold the Ed25519 keypair so the mock
// rawSign returns a genuinely valid signature over the requested hash.
const PRIVY_WALLET = Keypair.random();

function userSignedEnvelope(): string {
	const account = new Account(USER.publicKey(), "100");
	const tx = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: Networks.TESTNET,
	})
		.addOperation(
			Operation.payment({
				destination: Keypair.random().publicKey(),
				asset: Asset.native(),
				amount: "1.0000000",
			}),
		)
		.setTimeout(120)
		.build();
	tx.sign(USER);
	return tx.toXDR();
}

/** Mock Privy client backed by a real Ed25519 keypair (raw-signs the hash). */
function makePrivyClient() {
	return {
		rawSign: vi.fn(async (_walletId: string, input: { params: { hash: string } }) => {
			const hashHex = input.params.hash.replace(/^0x/, "");
			const sig = PRIVY_WALLET.sign(Buffer.from(hashHex, "hex"));
			return { signature: `0x${sig.toString("hex")}` };
		}),
	} satisfies PrivyWalletClient & { rawSign: ReturnType<typeof vi.fn> };
}

function privyEnv(
	overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
		COMPASS_STELLAR_SIGNER_PROVIDER: "privy",
		PRIVY_APP_ID: "app-123",
		PRIVY_APP_SECRET: "super-secret-value",
		COMPASS_STELLAR_PRIVY_WALLET_ID: "wallet-abc",
		COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY: PRIVY_WALLET.publicKey(),
		...overrides,
	};
}

describe("createPrivyStellarCosigner", () => {
	it("co-signs via Privy on ALLOW and attaches a VALID Ed25519 signature", async () => {
		const client = makePrivyClient();
		const cosigner = createPrivyStellarCosigner({ env: privyEnv(), client });
		const envelope = userSignedEnvelope();

		const result = await cosigner.cosign({
			envelopeXdr: envelope,
			decision: COMPASS_DECISIONS.ALLOW,
		});

		expect(result.signed).toBe(true);
		if (!result.signed) return;
		expect(result.signerPublicKey).toBe(PRIVY_WALLET.publicKey());
		expect(client.rawSign).toHaveBeenCalledTimes(1);

		// The attached signature must genuinely verify: user sig + Privy sig = 2,
		// and the Privy hint must be present (addSignature already validated it).
		const reparsed = TransactionBuilder.fromXDR(result.signedXdr, Networks.TESTNET);
		expect(reparsed.signatures).toHaveLength(2);
		expect(
			reparsed.signatures.some((s) =>
				s.hint().equals(PRIVY_WALLET.signatureHint()),
			),
		).toBe(true);
	});

	it("withholds on DENY (POLICY_NOT_ALLOWED) and never calls Privy", async () => {
		const client = makePrivyClient();
		const cosigner = createPrivyStellarCosigner({ env: privyEnv(), client });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.DENY,
		});
		expect(result).toEqual({ signed: false, reason: "POLICY_NOT_ALLOWED" });
		expect(client.rawSign).not.toHaveBeenCalled();
	});

	it("enforces envelope-to-candidate binding before calling Privy", async () => {
		const client = makePrivyClient();
		const cosigner = createPrivyStellarCosigner({ env: privyEnv(), client });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
			expectedEnvelopeFingerprint: "not-the-real-hash",
		});
		expect(result).toMatchObject({ signed: false, reason: "ENVELOPE_CANDIDATE_MISMATCH" });
		expect(client.rawSign).not.toHaveBeenCalled();
	});

	it("fails closed when a Privy var is missing", async () => {
		const cosigner = createPrivyStellarCosigner({
			env: privyEnv({ PRIVY_APP_SECRET: undefined }),
			client: makePrivyClient(),
		});
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(result).toMatchObject({ signed: false, reason: "COMPASS_SIGNER_NOT_CONFIGURED" });
	});

	it("refuses a mainnet passphrase", async () => {
		const cosigner = createPrivyStellarCosigner({
			env: privyEnv({ STELLAR_NETWORK_PASSPHRASE: Networks.PUBLIC }),
			client: makePrivyClient(),
		});
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(result).toMatchObject({ signed: false, reason: "COMPASS_SIGNER_MAINNET_FORBIDDEN" });
	});

	it("never leaks the Privy app secret in the result", async () => {
		const cosigner = createPrivyStellarCosigner({ env: privyEnv(), client: makePrivyClient() });
		const result = await cosigner.cosign({
			envelopeXdr: userSignedEnvelope(),
			decision: COMPASS_DECISIONS.ALLOW,
		});
		expect(JSON.stringify(result)).not.toContain("super-secret-value");
	});
});

describe("resolveStellarCosigner", () => {
	it("returns the local signer by default", () => {
		const cosigner = resolveStellarCosigner({
			STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
		});
		// local signer with no secret configured -> getPublicKey null
		expect(cosigner.getPublicKey()).toBeNull();
	});

	it("returns the Privy signer when selected", () => {
		const cosigner = resolveStellarCosigner(privyEnv(), { client: makePrivyClient() });
		expect(cosigner.getPublicKey()).toBe(PRIVY_WALLET.publicKey());
	});
});

describe("no legacy imports", () => {
	it("Privy signer files do not import from legacy/", () => {
		for (const rel of ["privyClient.ts", "privyStellarCosigner.ts", "stellarCosignerFactory.ts"]) {
			const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
			expect(source).not.toMatch(/legacy\//);
		}
	});
});
