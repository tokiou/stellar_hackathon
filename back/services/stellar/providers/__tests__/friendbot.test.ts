import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { TESTNET_PASSPHRASE } from "../stellarNetworkConfig";
import { fundTestnetAccount } from "../friendbot";

const ORIGINAL_ENV = { ...process.env };
const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

beforeEach(() => {
	process.env.STELLAR_NETWORK = "testnet";
	process.env.STELLAR_NETWORK_PASSPHRASE = TESTNET_PASSPHRASE;
	process.env.STELLAR_FRIENDBOT_URL = "https://friendbot.example.test";
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("fundTestnetAccount", () => {
	it("calls Friendbot with the account and reports funded on success", async () => {
		const fetchMock = vi.fn<[string | URL], Promise<Response>>(
			async () => new Response("{}", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await fundTestnetAccount(PUBLIC_KEY);

		expect(result).toEqual({ funded: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
		expect(calledUrl).toContain("https://friendbot.example.test");
		expect(calledUrl).toContain(encodeURIComponent(PUBLIC_KEY));
	});

	it("throws (does not swallow) when Friendbot returns a non-OK status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 400, statusText: "Bad Request" })),
		);

		await expect(fundTestnetAccount(PUBLIC_KEY)).rejects.toThrow(
			/FRIENDBOT_FUNDING_FAILED/,
		);
	});

	it("rejects an empty public key", async () => {
		await expect(fundTestnetAccount("  ")).rejects.toThrow(
			/FRIENDBOT_INVALID_PUBLIC_KEY/,
		);
	});
});
