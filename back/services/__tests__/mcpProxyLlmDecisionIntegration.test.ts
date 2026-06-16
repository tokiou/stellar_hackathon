import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluateLlmMetadataParams } from "../intelligence/llm-decision/llmDecisionAdapter";
import { createFakeDownstreamMcpServer } from "./fixtures/fakeDownstreamMcpServer";
import { createProxyDispatcher } from "../mcp/mcpProxyDispatcher";
import {
	listProxyAuditEvents,
	resetProxyAuditEvents,
} from "../mcp/mcpProxyAudit";

const mockState = vi.hoisted(() => ({
	route: "transfer" as "transfer" | "swap" | "skip" | "unknown",
	decisionEnabled: true,
	decision: "ALLOW" as "ALLOW" | "DENY" | "REQUIRE_HUMAN_APPROVAL",
	clamped: false,
	rationale: "Allowed.",
	evaluateCalls: [] as EvaluateLlmMetadataParams[],
}));

vi.mock("../intelligence/llm-router/llmRouterAdapter", () => ({
	resolveRouterConfig: vi.fn(() => ({
		enabled: true,
		timeoutMs: 3000,
		provider: "opencode-go",
		model: "kimi-k2.5",
		baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
	})),
	routeToolCall: vi.fn(async () => ({
		classification: mockState.route,
		reasoning: `${mockState.route} route`,
		latencyMs: 5,
	})),
}));

vi.mock("../intelligence/llm-decision/llmDecisionAdapter", () => ({
	resolveLlmConfig: vi.fn(() => ({
		enabled: mockState.decisionEnabled,
		provider: "opencode-go",
		model: "kimi-k2.5",
		baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
	})),
	evaluateLlmMetadata: vi.fn(async (params: EvaluateLlmMetadataParams) => {
		mockState.evaluateCalls.push(params);
		if (!params.config.enabled) {
			return {
				decision: params.input.deterministicDecision,
				llmConsulted: false,
				clamped: false,
			};
		}
		return {
			decision: mockState.decision,
			llmConsulted: true,
			clamped: mockState.clamped,
			llmRationale: mockState.rationale,
			llmReasonCodes: ["MOCK_LLM_DECISION"],
		};
	}),
}));

describe("MCP proxy LLM Decision integration", () => {
	beforeEach(() => {
		resetProxyAuditEvents();
		mockState.route = "transfer";
		mockState.decisionEnabled = true;
		mockState.decision = "ALLOW";
		mockState.clamped = false;
		mockState.rationale = "Allowed.";
		mockState.evaluateCalls = [];
	});

	it("evaluates transfer route with transfer context", async () => {
		mockState.route = "transfer";
		const dispatcher = createProxyDispatcher({
			downstream: createFakeDownstreamMcpServer(),
		});

		const result = await dispatcher.callTool({
			toolName: "portfolio_action",
			arguments: { amount: 1, recipient: "wallet" },
		});

		expect(result.outcome).toBe("allow");
		expect(mockState.evaluateCalls[0]?.input).toEqual(
			expect.objectContaining({
				toolName: "portfolio_action",
				actionKind: "transfer",
				riskClass: "transfer",
				sanitizedContext: {
					toolParams: { amount: 1, recipient: "wallet" },
				},
			}),
		);
	});

	it("evaluates swap route with swap context", async () => {
		mockState.route = "swap";
		const dispatcher = createProxyDispatcher({
			downstream: createFakeDownstreamMcpServer(),
		});

		const result = await dispatcher.callTool({
			toolName: "token_action",
			arguments: { inputToken: "SOL", outputToken: "USDC" },
		});

		expect(result.outcome).toBe("allow");
		expect(mockState.evaluateCalls[0]?.input).toEqual(
			expect.objectContaining({
				toolName: "token_action",
				actionKind: "swap",
				riskClass: "swap",
				sanitizedContext: {
					toolParams: { inputToken: "SOL", outputToken: "USDC" },
				},
			}),
		);
	});

	it("preserves router-only behavior when LLM Decision is disabled", async () => {
		mockState.route = "transfer";
		mockState.decisionEnabled = false;
		mockState.decision = "DENY";
		const downstream = createFakeDownstreamMcpServer();
		const dispatcher = createProxyDispatcher({ downstream });

		const result = await dispatcher.callTool({
			toolName: "portfolio_action",
			arguments: { amount: 1, recipient: "wallet" },
		});

		expect(result.outcome).toBe("allow");
		expect(downstream.recordedCalls).toHaveLength(1);
	});

	it("does not loosen a clamped gateway denial", async () => {
		mockState.route = "transfer";
		mockState.decision = "DENY";
		mockState.clamped = true;
		mockState.rationale = "Gateway deny preserved after LLM attempted allow.";
		const downstream = createFakeDownstreamMcpServer();
		const dispatcher = createProxyDispatcher({ downstream });

		const result = await dispatcher.callTool({
			toolName: "portfolio_action",
			arguments: { amount: 100_000, recipient: "blocked-wallet" },
		});

		expect(result.outcome).toBe("deny");
		expect(result.reason).toContain("Gateway deny preserved");
		expect(downstream.recordedCalls).toHaveLength(0);
	});

	it("records routing audit events", async () => {
		mockState.route = "swap";
		const dispatcher = createProxyDispatcher({
			downstream: createFakeDownstreamMcpServer(),
		});

		await dispatcher.callTool({
			toolName: "token_action",
			arguments: { inputToken: "SOL", outputToken: "USDC" },
		});

		expect(listProxyAuditEvents()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "proxy_audit_routing",
					toolName: "token_action",
					classification: "swap",
					reasoning: "swap route",
				}),
			]),
		);
	});
});
