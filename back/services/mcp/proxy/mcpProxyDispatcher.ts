/**
 * Proxy request dispatcher for Wave 11 MCP proxy.
 *
 * Dispatches MCP requests to proxy behavior: initialize, safe methods,
 * tools/list, and intercepted tools/call. Downstream `tools/list` is the
 * source of truth for public tool descriptors. `tools/call` is intercepted
 * by the policy interceptor before forwarding. All other requests either
 * pass through the safe-methods allowlist or fail closed.
 *
 * No native Compass MCP tool names, schemas, or static registry are used.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { debug } from "../../guardrail/debugLogger";
import { evaluateLlmMetadata, resolveLlmConfig } from "../../intelligence/llm-decision/llmDecisionAdapter";
import { routeToolCall, resolveRouterConfig } from "../../intelligence/llm-router/llmRouterAdapter";
import type {
	LlmRouterConfig,
	LlmRouterInput,
} from "../../intelligence/llm-router/llmRouterContracts";
import type { CompassDecision } from "../../guardrail/execution/executionGatewayContracts";
import type {
	ProxyCallToolResult,
	ProxyDecision,
	ProxyDispatcherConfig,
	ProxyListToolsResult,
	ProxyRouterClassification,
} from "./mcpProxyContracts";
import { isSafeNonToolMethod } from "./mcpProxyContracts";
import { evaluateProxyToolCallPolicy } from "./mcpProxyPolicyInterceptor";
import {
	markProxyAuditFailure,
	recordProxyAuditDenial,
	recordProxyAuditForwarding,
	recordProxyAuditIntent,
	recordProxyAuditRouting,
	redactSecretArguments,
} from "./mcpProxyAudit";

// ---------------------------------------------------------------------------
// Proxy dispatcher
// ---------------------------------------------------------------------------

/**
 * Create a proxy dispatcher that routes MCP requests through the proxy
 * boundary with policy interception and audit.
 *
 * The dispatcher depends on a downstream MCP client (injected via config).
 * Tests inject the fake fixture; production injects the real stdio client.
 */
export function createProxyDispatcher(
	config: ProxyDispatcherConfig,
): {
	listTools: () => Promise<ProxyListToolsResult>;
	callTool: (args: {
		toolName: string;
		arguments?: Record<string, unknown>;
	}) => Promise<ProxyCallToolResult>;
	forwardSafeRequest: (args: {
		method: string;
		params?: Record<string, unknown>;
	}) => Promise<unknown>;
} {
	const { downstream, policyDecision: policyOverride, auditFailure } = config;

	// If audit failure mode is requested (for testing), mark it now.
	if (auditFailure) {
		markProxyAuditFailure();
	}

	return {
		async listTools(): Promise<ProxyListToolsResult> {
			if (!downstream.isAvailable) {
				return {
					tools: [],
					errorReason:
						"Downstream MCP server is unavailable. " +
						"Proxy cannot discover tools from an unavailable downstream server.",
				};
			}

			try {
				const tools = await downstream.listTools();
				return { tools };
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				return {
					tools: [],
					errorReason:
						"Downstream tools/list discovery failed: " + errorMessage,
				};
			}
		},

		async callTool(args: {
			toolName: string;
			arguments?: Record<string, unknown>;
		}): Promise<ProxyCallToolResult> {
			// 1. Fail-closed: downstream unavailable
			if (!downstream.isAvailable) {
				const decision: ProxyDecision = {
					outcome: "deny",
					reason: "Downstream MCP server is unavailable; denying call fail-closed.",
					suggestedAction:
						"Restart the downstream server or check its configuration.",
				};
				recordProxyAuditDenial({
					toolName: args.toolName,
					policyDecision: decision,
					denialReason: decision.reason,
				});
				return {
					outcome: "deny",
					reason: decision.reason,
					suggestedAction: decision.suggestedAction,
					policyDecision: decision,
				};
			}

			// 2. Evaluate policy
			const evaluatedDecision = evaluateProxyToolCallPolicy(
				args.toolName,
				args.arguments,
				policyOverride ? { policyDecision: policyOverride } : undefined,
			);
			debug("proxy", "callTool", "Policy evaluation result", {
				tool: args.toolName,
				outcome: evaluatedDecision.outcome,
			});
			let forwardingDecision = evaluatedDecision;

			// 3. If policy requires approval but router is enabled, try LLM routing
			if (evaluatedDecision.outcome === "require_approval") {
				const routerConfig: LlmRouterConfig = resolveRouterConfig();

				if (routerConfig.enabled) {
					const routerInput: LlmRouterInput = {
						toolName: args.toolName,
						toolParams: args.arguments,
					};

					const routerResult = await routeToolCall(routerInput, routerConfig);
					const routerClassification: ProxyRouterClassification =
						routerResult.classification;
					debug("proxy", "callTool", "Router classification", {
						tool: args.toolName,
						classification: routerClassification,
						latencyMs: routerResult.latencyMs,
					});
					recordProxyAuditRouting({
						toolName: args.toolName,
						classification: routerClassification,
						reasoning: routerResult.reasoning,
						latencyMs: routerResult.latencyMs,
					});

					switch (routerClassification) {
						case "skip":
							forwardingDecision = {
								...evaluatedDecision,
								outcome: "allow",
								reason: `LLM Router classified tool "${args.toolName}" as skip; forwarding allowed.`,
								routerMetadata: {
									consulted: true,
									classification: "skip",
									reasoning: routerResult.reasoning,
									latencyMs: routerResult.latencyMs,
								},
							};
							break;

						case "transfer":
						case "swap": {
							const llmConfig = resolveLlmConfig();
							const llmDecision = await evaluateLlmMetadata({
								input: {
									toolName: args.toolName,
									actionKind: routerClassification,
									network: "solana",
									deterministicDecision: "ALLOW" as CompassDecision,
									riskClass: routerClassification,
									reasonCodes: [
										`router_classified_as_${routerClassification}`,
									],
									sanitizedContext: { toolParams: args.arguments },
									sanitized: true,
								},
								config: llmConfig,
							});

							if (llmDecision.decision === "ALLOW") {
								forwardingDecision = {
									...evaluatedDecision,
									outcome: "allow",
									reason: `LLM Decision allowed ${routerClassification} tool "${args.toolName}" after router classification.`,
									routerMetadata: {
										consulted: true,
										classification: routerClassification,
										reasoning: routerResult.reasoning,
										latencyMs: routerResult.latencyMs,
									},
								};
								break;
							}

							const outcome =
								llmDecision.decision === "DENY" ? "deny" : "require_approval";
							const finalDecision: ProxyDecision = {
								outcome,
								reason: `LLM Decision ${outcome}: ${llmDecision.llmRationale ?? routerResult.reasoning}`,
								suggestedAction:
									outcome === "deny" ? undefined : "Review and approve manually.",
								routerMetadata: {
									consulted: true,
									classification: routerClassification,
									reasoning: routerResult.reasoning,
									latencyMs: routerResult.latencyMs,
								},
							};
							recordProxyAuditDenial({
								toolName: args.toolName,
								policyDecision: finalDecision,
								denialReason: finalDecision.reason,
							});
							return {
								outcome: finalDecision.outcome,
								reason: finalDecision.reason,
								suggestedAction: finalDecision.suggestedAction,
								policyDecision: finalDecision,
							};
						}

						case "unknown": {
							const unknownDecision: ProxyDecision = {
								...evaluatedDecision,
								routerMetadata: {
									consulted: true,
									classification: "unknown",
									reasoning: routerResult.reasoning,
									latencyMs: routerResult.latencyMs,
								},
							};
							const unknownReason = `require_approval: LLM Router could not classify tool "${args.toolName}". ${evaluatedDecision.reason}`;
							recordProxyAuditDenial({
								toolName: args.toolName,
								policyDecision: unknownDecision,
								denialReason: unknownReason,
							});
							return {
								outcome: "require_approval",
								reason: unknownReason,
								suggestedAction: evaluatedDecision.suggestedAction,
								policyDecision: unknownDecision,
							};
						}
					}
				}
			}

			// 4. If policy does not allow, do NOT forward — return policy outcome
			if (forwardingDecision.outcome !== "allow") {
				debug("proxy", "callTool", "Request denied by policy", {
					tool: args.toolName,
					outcome: forwardingDecision.outcome,
				});
				const decisionPrefix =
					forwardingDecision.outcome === "deny" ? "denied" : "require_approval";
				const denialReason = `${decisionPrefix}: ${forwardingDecision.reason}`;
				recordProxyAuditDenial({
					toolName: args.toolName,
					policyDecision: forwardingDecision,
					denialReason,
				});
				return {
					outcome: forwardingDecision.outcome,
					reason: denialReason,
					suggestedAction: forwardingDecision.suggestedAction,
					policyDecision: forwardingDecision,
				};
			}

			// 5. Policy allows — record audit intent before forwarding
			let auditId: string;
			try {
				auditId = recordProxyAuditIntent({
					toolName: args.toolName,
					policyDecision: forwardingDecision,
				});
			} catch {
				// Audit write failure: fail closed, deny before forwarding
				const decision: ProxyDecision = {
					outcome: "deny",
					reason:
						"Proxy audit intent recording failed; denying call fail-closed to prevent unaudited forwarding.",
					suggestedAction:
						"Check proxy audit system health and retry.",
				};
				recordProxyAuditDenial({
					toolName: args.toolName,
					policyDecision: forwardingDecision,
					denialReason: decision.reason,
				});
				return {
					outcome: "deny",
					reason: decision.reason,
					suggestedAction: decision.suggestedAction,
					policyDecision: decision,
				};
			}

			// 6. Forward allowed call to downstream
			debug("proxy", "callTool", "Forwarding allowed call", {
				tool: args.toolName,
				outcome: forwardingDecision.outcome,
			});
			try {
				const redactedArgs = redactSecretArguments(args.arguments);
				void redactedArgs; // Available for future audit enrichment

				const downstreamResult = await downstream.callTool({
					toolName: args.toolName,
					arguments: args.arguments,
				});

				// 7. Record forwarding outcome
				recordProxyAuditForwarding({
					toolName: args.toolName,
					policyDecision: forwardingDecision,
					forwardingOutcome: "success",
					existingAuditId: auditId,
				});

				return {
					outcome: "allow",
					reason: `Tool "${args.toolName}" allowed and forwarded to downstream.`,
					data: downstreamResult as CallToolResult,
					policyDecision: forwardingDecision,
					auditId,
				};
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				// Downstream call failure: deny fail-closed
				recordProxyAuditForwarding({
					toolName: args.toolName,
					policyDecision: forwardingDecision,
					forwardingOutcome: "failure",
					existingAuditId: auditId,
				});

				const decision: ProxyDecision = {
					outcome: "deny",
					reason: `Downstream tools/call failed: ${errorMessage}. Denying fail-closed.`,
					suggestedAction:
						"Check downstream server health and retry.",
				};

				return {
					outcome: "deny",
					reason: decision.reason,
					suggestedAction: decision.suggestedAction,
					policyDecision: decision,
					auditId,
				};
			}
		},

		async forwardSafeRequest(args: {
			method: string;
			params?: Record<string, unknown>;
		}): Promise<unknown> {
			if (
				!isSafeNonToolMethod(args.method) ||
				args.method === "tools/call" ||
				isNotificationMethod(args.method)
			) {
				throw new Error(`Unsafe MCP method denied fail-closed: ${args.method}`);
			}
			if (!downstream.isAvailable || !downstream.forwardSafeRequest) {
				throw new Error(
					"Downstream MCP server is unavailable or cannot forward safe requests.",
				);
			}
			return downstream.forwardSafeRequest(args);
		},
	};
}

function isNotificationMethod(method: string): boolean {
	return method.startsWith("notifications/");
}

// Re-export audit helpers for test access and cleanup
export { resetProxyAuditEvents, listProxyAuditEvents } from "./mcpProxyAudit";
export type { DownstreamMcpTool } from "./mcpProxyContracts";
