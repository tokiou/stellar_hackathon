import { appendFile } from "node:fs/promises";

import type { ProxyCallToolResult } from "./mcpProxyContracts";

/**
 * Optional, fire-and-forget decision feed for the Compass dashboard.
 *
 * When `COMPASS_EVENTS_FILE` is set, each proxied tool-call decision is appended
 * as one JSON line. The dashboard tails that file. Telemetry must never break
 * the proxy: any failure here is swallowed. When the env var is unset this is a
 * no-op, so default behavior and tests are unaffected.
 */
export type ProxyDecisionEvent = {
	ts: string;
	tool: string;
	outcome: "allow" | "deny" | "require_approval";
	hostedDecision?: string;
	reason?: string;
};

export function emitProxyDecisionEvent(
	toolName: string,
	result: ProxyCallToolResult,
): void {
	const file = process.env.COMPASS_EVENTS_FILE;
	if (!file) {
		return;
	}
	const event: ProxyDecisionEvent = {
		ts: new Date().toISOString(),
		tool: toolName,
		outcome: result.outcome,
		hostedDecision: result.policyDecision?.hostedDecision,
		reason: result.reason,
	};
	// Fire-and-forget; never throw into the proxy path.
	void appendFile(file, `${JSON.stringify(event)}\n`).catch(() => {});
}
