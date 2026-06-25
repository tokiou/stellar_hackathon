import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	MAINNET_PASSPHRASE,
	TESTNET_PASSPHRASE,
	getStellarNetworkConfig,
	isSupportedStellarNetwork,
	type StellarNetworkErrorCode,
} from "../stellarNetworkConfig";

function baseEnv(
	overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
	return {
		STELLAR_NETWORK: "testnet",
		STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
		...overrides,
	};
}

function codeOf(fn: () => unknown): StellarNetworkErrorCode | undefined {
	try {
		fn();
	} catch (error) {
		return (error as { code?: StellarNetworkErrorCode }).code;
	}
	return undefined;
}

describe("getStellarNetworkConfig", () => {
	it("accepts testnet + the testnet passphrase and returns all five fields", () => {
		const config = getStellarNetworkConfig(baseEnv());
		expect(config.network).toBe("testnet");
		expect(config.networkPassphrase).toBe(TESTNET_PASSPHRASE);
		expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
		expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
		expect(config.friendbotUrl).toBe("https://friendbot.stellar.org");
	});

	it("honours overridden URLs from env", () => {
		const config = getStellarNetworkConfig(
			baseEnv({
				STELLAR_HORIZON_URL: "https://horizon.example.test",
				STELLAR_RPC_URL: "https://rpc.example.test",
				STELLAR_FRIENDBOT_URL: "https://friendbot.example.test",
			}),
		);
		expect(config.horizonUrl).toBe("https://horizon.example.test");
		expect(config.rpcUrl).toBe("https://rpc.example.test");
		expect(config.friendbotUrl).toBe("https://friendbot.example.test");
	});

	it("rejects any non-testnet network with unsupported_network", () => {
		expect(codeOf(() => getStellarNetworkConfig(baseEnv({ STELLAR_NETWORK: "mainnet" })))).toBe(
			"unsupported_network",
		);
		expect(codeOf(() => getStellarNetworkConfig(baseEnv({ STELLAR_NETWORK: "pubnet" })))).toBe(
			"unsupported_network",
		);
	});

	it("rejects the mainnet passphrase with mainnet_forbidden", () => {
		expect(
			codeOf(() =>
				getStellarNetworkConfig(
					baseEnv({ STELLAR_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE }),
				),
			),
		).toBe("mainnet_forbidden");
	});

	it("throws missing_network_config when the passphrase is absent", () => {
		expect(
			codeOf(() =>
				getStellarNetworkConfig({ STELLAR_NETWORK: "testnet" }),
			),
		).toBe("missing_network_config");
	});

	it("throws invalid_network_config for a wrong passphrase or malformed URL", () => {
		expect(
			codeOf(() =>
				getStellarNetworkConfig(
					baseEnv({ STELLAR_NETWORK_PASSPHRASE: "something else" }),
				),
			),
		).toBe("invalid_network_config");
		expect(
			codeOf(() =>
				getStellarNetworkConfig(baseEnv({ STELLAR_HORIZON_URL: "not-a-url" })),
			),
		).toBe("invalid_network_config");
	});

	it("never silently defaults to mainnet", () => {
		// With no network set it falls back to testnet, not mainnet.
		const config = getStellarNetworkConfig({
			STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
		});
		expect(config.network).toBe("testnet");
		expect(config.networkPassphrase).not.toBe(MAINNET_PASSPHRASE);
	});
});

describe("isSupportedStellarNetwork", () => {
	it("is true for testnet and false otherwise", () => {
		expect(isSupportedStellarNetwork("testnet")).toBe(true);
		expect(isSupportedStellarNetwork("mainnet")).toBe(false);
		expect(isSupportedStellarNetwork(undefined)).toBe(true); // defaults to testnet
	});
});

describe("no legacy imports in stellar provider files", () => {
	it("new Stellar files do not import from legacy/", () => {
		const files = [
			"stellarNetworkConfig.ts",
			"stellarConnection.ts",
			"friendbot.ts",
		];
		for (const rel of files) {
			const source = readFileSync(path.resolve(__dirname, "..", rel), "utf8");
			expect(source).not.toMatch(/legacy\//);
		}
	});
});
