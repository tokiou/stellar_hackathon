import { Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";

import { createPrivyStellarCosigner } from "../../signer/privyStellarCosigner";
import type { PrivyWalletClient } from "../../signer/privyClient";
import {
	createStellarProxyExecuteOverride,
	isCompassExecutedStellarTool,
} from "../stellarProxyExecutor";

const PRIVY_WALLET = Keypair.random();
const DEST = Keypair.random().publicKey();

function makePrivyClient(): PrivyWalletClient {
	return {
		rawSign: vi.fn(async (_walletId: string, input: { params: { hash: string } }) => {
			const sig = PRIVY_WALLET.sign(Buffer.from(input.params.hash.replace(/^0x/, ""), "hex"));
			return { signature: `0x${sig.toString("hex")}` };
		}),
	};
}

function env(overrides: Record<string, string | undefined> = {}) {
	return {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
		COMPASS_STELLAR_SIGNER_PROVIDER: "privy",
		PRIVY_APP_ID: "app",
		PRIVY_APP_SECRET: "secret",
		COMPASS_STELLAR_PRIVY_WALLET_ID: "wallet",
		COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY: PRIVY_WALLET.publicKey(),
		FALLBACK_XLM_USD_PRICE: "0.1",
		...overrides,
	};
}

function deps(overrides = {}) {
	return {
		env: env(),
		cosigner: createPrivyStellarCosigner({ env: env(), client: makePrivyClient() }),
		loadAccount: async () => ({ sequence: "100", medThreshold: 0 }),
		submit: vi.fn(async () => ({ hash: "txhash123" })),
		knownRecipients: [DEST],
		...overrides,
	};
}

describe("isCompassExecutedStellarTool", () => {
	it("recognizes stellar_payment, not reads", () => {
		expect(isCompassExecutedStellarTool("stellar_payment")).toBe(true);
		expect(isCompassExecutedStellarTool("stellar_balance")).toBe(false);
	});
});

describe("createStellarProxyExecuteOverride", () => {
	it("forwards read-only tools (override returns null)", async () => {
		const override = createStellarProxyExecuteOverride(deps());
		const result = await override({ toolName: "stellar_balance", arguments: { account: "G..." } });
		expect(result).toBeNull();
	});

	it("BLOCKS fund-moving tools it cannot co-sign via Privy (no self-signing)", async () => {
		const override = createStellarProxyExecuteOverride(deps());
		for (const tool of ["stellar_change_trust", "stellar_claim_claimable_balance", "soroban_deploy"]) {
			const result = await override({ toolName: tool, arguments: {} });
			expect(result?.outcome).toBe("deny");
		}
	});

	it("BLOCKS any call carrying a raw secret key (anti self-sign)", async () => {
		const override = createStellarProxyExecuteOverride(deps());
		const result = await override({
			toolName: "stellar_create_asset",
			arguments: { issuerSecretKey: "SABC...", code: "USDC" },
		});
		expect(result?.outcome).toBe("deny");
	});

	it("ALLOW: co-signs via Privy and submits, marking the signer", async () => {
		const d = deps();
		const override = createStellarProxyExecuteOverride(d);
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "5" }, // ~$0.5 within policy, known recipient
		});
		expect(result?.outcome).toBe("allow");
		expect(result?.data?.structuredContent).toMatchObject({
			compassSigner: "privy",
			txHash: "txhash123",
		});
		expect(d.submit).toHaveBeenCalledTimes(1);
	});

	it("ESCALATE: amount out of range -> not signed, not submitted", async () => {
		const d = deps();
		const override = createStellarProxyExecuteOverride(d);
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "2000" }, // ~$200 > $10
		});
		expect(result?.outcome).toBe("require_approval");
		expect(d.submit).not.toHaveBeenCalled();
	});

	it("DENY: blocked recipient -> not signed", async () => {
		const blockedPolicy = {
			...DEFAULT_POLICY,
			transfers: { ...DEFAULT_POLICY.transfers, blocked_recipients: [DEST] },
		};
		const d = deps({ policy: blockedPolicy });
		const override = createStellarProxyExecuteOverride(d);
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "5" },
		});
		expect(result?.outcome).toBe("deny");
		expect(d.submit).not.toHaveBeenCalled();
	});

	it("invalid destination -> deny (build fails safely)", async () => {
		const d = deps();
		const override = createStellarProxyExecuteOverride(d);
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: "not-a-stellar-key", amount: "5" },
		});
		expect(result?.outcome).toBe("deny");
		expect(d.submit).not.toHaveBeenCalled();
	});

	it("denies when no Privy source wallet is configured", async () => {
		const override = createStellarProxyExecuteOverride({
			...deps(),
			env: env({ COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY: undefined }),
		});
		const result = await override({
			toolName: "stellar_payment",
			arguments: { destination: DEST, amount: "5" },
		});
		expect(result?.outcome).toBe("deny");
	});
});
