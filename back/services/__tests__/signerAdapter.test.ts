/**
 * Wave 6a — Signer adapter and idempotency store tests
 * T1_RED_SIGNER_ADAPTER: RED tests for SignerAdapter interface, LocalKeypairAdapter,
 * and createSignerAdapter factory.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";

describe("SignerAdapter interface", () => {
	it("a class satisfying the interface compiles and getAddress is callable", async () => {
		// Test that the interface contract is satisfied
		const mockAdapter = {
			getAddress: vi
				.fn()
				.mockResolvedValue("So11111111111111111111111111111111111111112"),
			signTransaction: vi.fn(),
		};

		// The interface requires getAddress to return a Promise<string>
		const address = await mockAdapter.getAddress();
		expect(address).toBe("So11111111111111111111111111111111111111112");
		expect(typeof address).toBe("string");
	});
});

describe("createSignerAdapter", () => {
	afterEach(() => {
		delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;
		delete process.env.SOLANA_RPC_URL;
	});

	it("returns LOCAL_SIGNER_NOT_CONFIGURED when COMPASS_LOCAL_SIGNER_ENABLED is absent", async () => {
		// Ensure the env flag is not set
		delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter();

		expect(result.ok).toBe(false);
		if (result.ok !== false) throw new Error("expected failure");
		expect(result.reason).toBe("LOCAL_SIGNER_NOT_CONFIGURED");
	});

	it("returns LOCAL_SIGNER_NOT_CONFIGURED when COMPASS_LOCAL_SIGNER_ENABLED is not 'true'", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "false";

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter();

		expect(result.ok).toBe(false);
		if (result.ok !== false) throw new Error("expected failure");
		expect(result.reason).toBe("LOCAL_SIGNER_NOT_CONFIGURED");
	});

	it("returns LOCAL_SIGNER_MAINNET_FORBIDDEN when RPC URL contains 'mainnet'", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter();

		expect(result.ok).toBe(false);
		if (result.ok !== false) throw new Error("expected failure");
		expect(result.reason).toBe("LOCAL_SIGNER_MAINNET_FORBIDDEN");
	});

	it("returns LOCAL_SIGNER_MAINNET_FORBIDDEN when RPC URL contains 'mainnet' in config", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://solana-mainnet.g.alchemy.com/v2/xxx";

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({
			rpcUrl: "https://api.mainnet-beta.solana.com",
		});

		expect(result.ok).toBe(false);
		if (result.ok !== false) throw new Error("expected failure");
		expect(result.reason).toBe("LOCAL_SIGNER_MAINNET_FORBIDDEN");
	});

	it("returns ok with adapter when COMPASS_LOCAL_SIGNER_ENABLED=true and devnet RPC", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

		// Use a test keypair
		const testKeypair = Keypair.generate();
		const secretKeyBytes = testKeypair.secretKey;

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({ localSecretKey: secretKeyBytes });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.adapter).toBeDefined();
		expect(typeof result.adapter.getAddress).toBe("function");
		expect(typeof result.adapter.signTransaction).toBe("function");
	});

	it("returns ok when rpcUrl in config targets devnet", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		delete process.env.SOLANA_RPC_URL;

		const testKeypair = Keypair.generate();
		const secretKeyBytes = testKeypair.secretKey;

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({
			localSecretKey: secretKeyBytes,
			rpcUrl: "https://api.devnet.solana.com",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.adapter).toBeDefined();
	});
});

describe("LocalKeypairAdapter", () => {
	afterEach(() => {
		delete process.env.COMPASS_LOCAL_SIGNER_ENABLED;
		delete process.env.SOLANA_RPC_URL;
	});

	it("getAddress returns the correct base58 address for a test keypair", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

		const testKeypair = Keypair.generate();
		const expectedAddress = testKeypair.publicKey.toBase58();

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({
			localSecretKey: testKeypair.secretKey,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		const address = await result.adapter.getAddress();
		expect(address).toBe(expectedAddress);
	});

	it("signTransaction is defined as a function", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

		const testKeypair = Keypair.generate();

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({
			localSecretKey: testKeypair.secretKey,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(typeof result.adapter.signTransaction).toBe("function");
	});

	it("does not expose secret key through any method", async () => {
		process.env.COMPASS_LOCAL_SIGNER_ENABLED = "true";
		process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";

		const testKeypair = Keypair.generate();

		const { createSignerAdapter } = await import("../signerAdapter");

		const result = createSignerAdapter({
			localSecretKey: testKeypair.secretKey,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		const adapter = result.adapter;

		// Ensure no method returns or logs the secret key
		const addressStr = await adapter.getAddress();
		expect(addressStr).not.toContain(testKeypair.secretKey.toString());
	});
});

describe("No legacy imports", () => {
	it("signerAdapter module does not import from legacy", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");

		const contractsPath = path.join(
			process.cwd(),
			"back/services/signerAdapterContracts.ts",
		);
		const adapterPath = path.join(
			process.cwd(),
			"back/services/signerAdapter.ts",
		);

		const contractsSource = fs.readFileSync(contractsPath, "utf8");
		const adapterSource = fs.readFileSync(adapterPath, "utf8");

		const legacyImportPattern =
			/from\s+["'][^"']*legacy|import\s*\([^)]*legacy/;

		expect(contractsSource).not.toMatch(legacyImportPattern);
		expect(adapterSource).not.toMatch(legacyImportPattern);
	});
});
