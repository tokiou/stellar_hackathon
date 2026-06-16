#!/usr/bin/env node
// Dump proxy audit events after running tool calls through the dispatcher directly.
// No MCP server needed — imports the dispatcher directly.

import { createProxyDispatcher } from "../back/services/mcp/proxy/mcpProxyDispatcher.ts";
import { listProxyAuditEvents, resetProxyAuditEvents } from "../back/services/mcp/proxy/mcpProxyAudit.ts";
import { createFakeDownstreamMcpServer } from "../back/services/__tests__/fixtures/fakeDownstreamMcpServer.ts";

resetProxyAuditEvents();
const downstream = createFakeDownstreamMcpServer();
const dispatcher = createProxyDispatcher({ downstream });

const tools = [
  { toolName: "getPortfolioBalance", arguments: {} },
  { toolName: "getTokenPrice", arguments: { token: "BTC" } },
  { toolName: "sendToken", arguments: { token: "USDC", amount: 10, toAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } },
  { toolName: "swapToken", arguments: { fromToken: "SOL", toToken: "USDC", amount: 2 } },
  { toolName: "createOrder", arguments: { pair: "BTC-USD", side: "BUY", size: 0.001 } },
  { toolName: "echo", arguments: { message: "test" } },
];

console.log("Running tool calls through dispatcher...\n");

for (const tool of tools) {
  const result = await dispatcher.callTool(tool);
  console.log(`  ${tool.toolName.padEnd(22)} → ${result.outcome} ${result.reason ? "(" + result.reason.slice(0, 70) + ")" : ""}`);
}

console.log("\n=== AUDIT EVENTS ===\n");

const events = listProxyAuditEvents();
if (events.length === 0) {
  console.log("  (no events recorded)");
} else {
  for (const event of events) {
    const ts = event.timestamp.split("T")[1]?.split(".")[0] ?? "";
    switch (event.type) {
      case "proxy_audit_intent":
        console.log(`  [${ts}] INTENT   ${event.toolName.padEnd(22)} → ${event.policyDecision.outcome}  auditId=${event.auditId}`);
        break;
      case "proxy_audit_denial":
        console.log(`  [${ts}] DENIAL   ${event.toolName.padEnd(22)} → ${event.policyDecision.outcome}  reason=${event.denialReason.slice(0, 60)}`);
        break;
      case "proxy_audit_forwarding":
        console.log(`  [${ts}] FWD      ${event.toolName.padEnd(22)} → ${event.forwardingOutcome}  auditId=${event.auditId}`);
        break;
      case "proxy_audit_routing":
        console.log(`  [${ts}] ROUTE    ${event.toolName.padEnd(22)} → classification=${event.classification}  reasoning=${event.reasoning.slice(0, 50)}  latency=${event.latencyMs}ms`);
        break;
      case "proxy_audit_failure":
        console.log(`  [${ts}] FAILURE  ${event.toolName.padEnd(22)} → error=${event.error}`);
        break;
    }
  }
}

console.log(`\nTotal: ${events.length} events`);
