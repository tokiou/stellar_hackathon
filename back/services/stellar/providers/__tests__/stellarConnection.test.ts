import { Horizon, rpc } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TESTNET_PASSPHRASE } from "../stellarNetworkConfig";
import {
	getHorizonServer,
	getSorobanRpc,
	resetStellarClients,
} from "../stellarConnection";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env.STELLAR_NETWORK = "testnet";
	process.env.STELLAR_NETWORK_PASSPHRASE = TESTNET_PASSPHRASE;
	resetStellarClients();
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	resetStellarClients();
});

describe("stellarConnection", () => {
	it("getHorizonServer returns a Horizon.Server built from config", () => {
		const server = getHorizonServer();
		expect(server).toBeInstanceOf(Horizon.Server);
	});

	it("getSorobanRpc returns an rpc.Server built from config", () => {
		const server = getSorobanRpc();
		expect(server).toBeInstanceOf(rpc.Server);
	});

	it("returns singleton clients (same instance across calls)", () => {
		expect(getHorizonServer()).toBe(getHorizonServer());
		expect(getSorobanRpc()).toBe(getSorobanRpc());
	});

	it("propagates the testnet-only config guard (no passphrase -> throws)", () => {
		delete process.env.STELLAR_NETWORK_PASSPHRASE;
		resetStellarClients();
		expect(() => getHorizonServer()).toThrow();
	});
});
