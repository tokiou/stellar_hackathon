import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emitProxyDecisionEvent } from "../proxyEventLog";

const ORIGINAL = process.env.COMPASS_EVENTS_FILE;

afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.COMPASS_EVENTS_FILE;
	else process.env.COMPASS_EVENTS_FILE = ORIGINAL;
});

describe("emitProxyDecisionEvent", () => {
	it("is a no-op when COMPASS_EVENTS_FILE is unset", () => {
		delete process.env.COMPASS_EVENTS_FILE;
		expect(() =>
			emitProxyDecisionEvent("stellar_payment", {
				outcome: "deny",
				reason: "deny: blocked",
			}),
		).not.toThrow();
	});

	it("appends one JSON line per decision when the file is set", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "compass-events-"));
		const file = path.join(dir, "events.jsonl");
		process.env.COMPASS_EVENTS_FILE = file;

		emitProxyDecisionEvent("stellar_balance", {
			outcome: "allow",
			reason: "allow: read-only",
			policyDecision: { outcome: "allow", hostedDecision: "allow", reason: "read-only" },
		});
		emitProxyDecisionEvent("stellar_payment", {
			outcome: "deny",
			reason: "deny: fail-closed",
		});

		// appendFile is async fire-and-forget; wait a tick.
		await new Promise((r) => setTimeout(r, 50));

		expect(existsSync(file)).toBe(true);
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0]);
		expect(first.tool).toBe("stellar_balance");
		expect(first.outcome).toBe("allow");
		expect(first.hostedDecision).toBe("allow");
		expect(typeof first.ts).toBe("string");
		expect(JSON.parse(lines[1]).outcome).toBe("deny");
	});
});
