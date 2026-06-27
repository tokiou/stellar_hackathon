#!/usr/bin/env node
/**
 * Stellar onboarding MCP (stdio) — exposes Privy wallet provisioning as a tool.
 *
 * Lets you validate the provisioning flow FROM an MCP (e.g. through the Compass
 * proxy / Claude), while the provisioning logic itself lives in
 * back/services/stellar/signer/privyProvisioning.ts and works INDEPENDENTLY of
 * this server. Run with tsx so the TS module resolves:
 *   npx tsx scripts/stellar-onboarding-mcp.mjs
 *
 * Real Privy when PRIVY_APP_ID/PRIVY_APP_SECRET are set; simulated otherwise.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { provisionStellarWallet } from "../back/services/stellar/signer/privyProvisioning.ts";

const server = new Server(
	{ name: "stellar-onboarding", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "provision_stellar_wallet",
			description:
				"Provision (onboard) a new Stellar Ed25519 server wallet for an agent via Privy. Returns walletId and the Stellar G… address.",
			inputSchema: {
				type: "object",
				properties: {
					userId: { type: "string", description: "Optional Privy user id to own the wallet." },
				},
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	if (request.params.name !== "provision_stellar_wallet") {
		return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
	}
	const userId = request.params.arguments?.userId;
	const result = await provisionStellarWallet({ userId });
	// Never echo a simulated secret through the tool result.
	const safe =
		result.ok && "simulatedSecret" in result
			? { ...result, simulatedSecret: "[hidden — testnet only]" }
			: result;
	return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }], isError: !result.ok };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Stellar onboarding MCP running");
