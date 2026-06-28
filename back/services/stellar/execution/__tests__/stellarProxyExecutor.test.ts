import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import { describe, expect, it, vi } from "vitest";

import { createPrivyStellarCosigner } from "../../signer/privyStellarCosigner";
import type { PrivyWalletClient } from "../../signer/privyClient";
import { createStellarProxyExecuteOverride } from "../stellarProxyExecutor";

// The agent's wallet (Compass NEVER sees this key — it only co-signs).
const AGENT = Keypair.random();
// Compass's co-signer key (in tests a local keypair stands in for the Privy TEE).
const COMPASS = Keypair.random();
const DEST = Keypair.random().publicKey();

const PASSPHRASE = Networks.TESTNET;

/** Mock Privy client backed by a real Ed25519 keypair (Compass's co-signer). */
function makePrivyClient(): PrivyWalletClient {
	return {
		rawSign: vi.fn(async (_walletId: string, input: { params: { hash: string } }) => {
			const sig = COMPASS.sign(Buffer.from(input.params.hash.replace(/^0x/, ""), "hex"));
			return { signature: `0x${sig.toString("hex")}` };
		}),
	};
}

function privyEnv(overrides: Record<string, string | undefined> = {}) {
	return {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: PASSPHRASE,
		COMPASS_STELLAR_SIGNER_PROVIDER: "privy",
		PRIVY_APP_ID: "app",
		PRIVY_APP_SECRET: "secret",
		COMPASS_STELLAR_PRIVY_WALLET_ID: "wallet",
		COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY: COMPASS.publicKey(),
		FALLBACK_XLM_USD_PRICE: "0.1",
		...overrides,
	};
}

/** A 2-of-2 multisig account: agent (master) + Compass, threshold 2. */
function multisigAccount() {
	return {
		signers: [
			{ key: AGENT.publicKey(), weight: 1 },
			{ key: COMPASS.publicKey(), weight: 1 },
		],
		thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 2 },
	};
}

function cosigner() {
	return createPrivyStellarCosigner({
		env: privyEnv(),
		client: makePrivyClient(),
		loadAccount: async () => multisigAccount(),
	});
}

/** Build a payment from the agent account and sign it with the AGENT key only. */
function agentSignedPayment(amount: string, destination = DEST): string {
	const tx = new TransactionBuilder(new Account(AGENT.publicKey(), "100"), {
		fee: "100",
		networkPassphrase: PASSPHRASE,
	})
		.addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
		.setTimeout(120)
		.build();
	tx.sign(AGENT); // ONLY the agent signs — 1 signature
	return tx.toXDR();
}

function makeOverride(extra: Record<string, unknown> = {}) {
	const submit = vi.fn<[string], Promise<{ hash: string }>>(async () => ({
		hash: "txhash_abc",
	}));
	const override = createStellarProxyExecuteOverride({
		env: privyEnv(),
		cosigner: cosigner(),
		submit,
		knownRecipients: [DEST],
		...extra,
	});
	return { override, submit };
}

describe("createStellarProxyExecuteOverride — real co-signing", () => {
	it("ALLOW: co-signs an agent-signed tx (2 sigs) and submits", async () => {
		const { override, submit } = makeOverride();
		const result = await override({
			toolName: "stellar_payment",
			arguments: { envelopeXdr: agentSignedPayment("50") }, // ~$5 within policy, known recipient
		});

		expect(result?.outcome).toBe("allow");
		expect(result?.data?.structuredContent).toMatchObject({
			compassSigner: "privy",
			txHash: "txhash_abc",
			collectedSigners: 2,
		});
		expect(submit).toHaveBeenCalledTimes(1);

		// The submitted XDR carries BOTH the agent's and Compass's signatures.
		const submitted = submit.mock.calls[0][0] as string;
		const tx = TransactionBuilder.fromXDR(submitted, PASSPHRASE);
		expect(tx.signatures).toHaveLength(2);
		const hints = tx.signatures.map((s) => s.hint().toString("hex"));
		expect(hints).toContain(AGENT.signatureHint().toString("hex"));
		expect(hints).toContain(COMPASS.signatureHint().toString("hex"));
	});

	it("rejects a transaction the agent did NOT sign (Compass only co-signs)", async () => {
		const { override, submit } = makeOverride();
		// Build the same payment but DO NOT sign it.
		const unsigned = new TransactionBuilder(new Account(AGENT.publicKey(), "100"), {
			fee: "100",
			networkPassphrase: PASSPHRASE,
		})
			.addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: "5" }))
			.setTimeout(120)
			.build()
			.toXDR();

		const result = await override({
			toolName: "stellar_payment",
			arguments: { envelopeXdr: unsigned },
		});
		expect(result?.outcome).toBe("deny");
		expect(submit).not.toHaveBeenCalled();
	});

	it("refuses to co-sign if the account is NOT 2-of-2 with Compass required", async () => {
		// Account where Compass is NOT a signer / threshold < 2.
		const soloCosigner = createPrivyStellarCosigner({
			env: privyEnv(),
			client: makePrivyClient(),
			loadAccount: async () => ({
				signers: [{ key: AGENT.publicKey(), weight: 1 }],
				thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 },
			}),
		});
		const submit = vi.fn<[string], Promise<{ hash: string }>>(async () => ({ hash: "x" }));
		const override = createStellarProxyExecuteOverride({
			env: privyEnv(),
			cosigner: soloCosigner,
			submit,
			knownRecipients: [DEST],
		});
		const result = await override({
			toolName: "stellar_payment",
			arguments: { envelopeXdr: agentSignedPayment("50") },
		});
		expect(result?.outcome).toBe("deny");
		expect(submit).not.toHaveBeenCalled();
	});

	it("ESCALATE: amount out of range -> no co-sign, no submit", async () => {
		const { override, submit } = makeOverride();
		const result = await override({
			toolName: "stellar_payment",
			arguments: { envelopeXdr: agentSignedPayment("2000") }, // ~$200 > $10
		});
		expect(result?.outcome).toBe("require_approval");
		expect(submit).not.toHaveBeenCalled();
	});

	it("DENY: blocked recipient -> no co-sign", async () => {
		const blockedPolicy = {
			...DEFAULT_POLICY,
			transfers: { ...DEFAULT_POLICY.transfers, blocked_recipients: [DEST] },
		};
		const { override, submit } = makeOverride({ policy: blockedPolicy });
		const result = await override({
			toolName: "stellar_payment",
			arguments: { envelopeXdr: agentSignedPayment("5") },
		});
		expect(result?.outcome).toBe("deny");
		expect(submit).not.toHaveBeenCalled();
	});

	it("BLOCKS a self-signing call (raw secret key in args)", async () => {
		const { override, submit } = makeOverride();
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "5", secretKey: AGENT.secret() },
		});
		expect(result?.outcome).toBe("deny");
		expect(submit).not.toHaveBeenCalled();
	});

	it("BLOCKS an unsigned fund-moving intent (no envelopeXdr)", async () => {
		const { override } = makeOverride();
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "5" },
		});
		expect(result?.outcome).toBe("deny");
	});

	it("forwards read-only Stellar tools (returns null)", async () => {
		const { override } = makeOverride();
		const result = await override({ toolName: "stellar_balance", arguments: { account: DEST } });
		expect(result).toBeNull();
	});

	it("ignores non-Stellar downstream tools (returns null -> normal proxy gate)", async () => {
		const { override } = makeOverride();
		for (const tool of ["sendToken", "swapToken", "createOrder", "transfer"]) {
			const result = await override({ toolName: tool, arguments: { amount: "5" } });
			expect(result).toBeNull();
		}
	});
});
