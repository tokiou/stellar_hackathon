import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import type { PrivyWalletClient } from "../privyClient";
import {
	provisionStellarWallet,
	toStellarAddress,
} from "../privyProvisioning";

const REAL_ENV = {
	PRIVY_APP_ID: "app-123",
	PRIVY_APP_SECRET: "secret-xyz",
};

describe("toStellarAddress", () => {
	it("uses the address when it is a valid Stellar G… key", () => {
		const kp = Keypair.random();
		expect(toStellarAddress({ id: "w", address: kp.publicKey() })).toBe(
			kp.publicKey(),
		);
	});

	it("derives the G… address from a raw ed25519 hex public key", () => {
		const kp = Keypair.random();
		const rawHex = StrKey.decodeEd25519PublicKey(kp.publicKey()).toString("hex");
		expect(toStellarAddress({ id: "w", public_key: `0x${rawHex}` })).toBe(
			kp.publicKey(),
		);
	});
});

describe("provisionStellarWallet — real Privy (mocked client)", () => {
	it("creates a stellar wallet and returns walletId + G… address", async () => {
		const kp = Keypair.random();
		const client: PrivyWalletClient = {
			rawSign: vi.fn(),
			create: vi.fn(async (input) => {
				expect(input.chain_type).toBe("stellar");
				return { id: "wallet-abc", address: kp.publicKey() };
			}),
		};
		const result = await provisionStellarWallet({ env: REAL_ENV, client });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.provider).toBe("privy");
		expect(result.walletId).toBe("wallet-abc");
		expect(StrKey.isValidEd25519PublicKey(result.stellarPublicKey)).toBe(true);
		expect(result.stellarPublicKey).toBe(kp.publicKey());
	});

	it("derives the address when Privy returns only a raw public_key", async () => {
		const kp = Keypair.random();
		const rawHex = StrKey.decodeEd25519PublicKey(kp.publicKey()).toString("hex");
		const client: PrivyWalletClient = {
			rawSign: vi.fn(),
			create: vi.fn(async () => ({ id: "w2", public_key: rawHex })),
		};
		const result = await provisionStellarWallet({ env: REAL_ENV, client });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.stellarPublicKey).toBe(kp.publicKey());
	});

	it("returns PROVISION_FAILED when Privy create throws", async () => {
		const client: PrivyWalletClient = {
			rawSign: vi.fn(),
			create: vi.fn(async () => {
				throw new Error("privy 500");
			}),
		};
		const result = await provisionStellarWallet({ env: REAL_ENV, client });
		expect(result).toMatchObject({ ok: false, reason: "PROVISION_FAILED" });
	});
});

describe("provisionStellarWallet — simulated (no credentials)", () => {
	it("returns a valid G… address and a secret when Privy is not configured", async () => {
		const result = await provisionStellarWallet({ env: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.provider).toBe("simulated");
		expect(StrKey.isValidEd25519PublicKey(result.stellarPublicKey)).toBe(true);
		expect(result.simulatedSecret).toMatch(/^S/);
	});
});
