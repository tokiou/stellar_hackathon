import {
	Account,
	Asset,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { ProxyCallToolResult } from "@back/services/mcp/proxy/mcpProxyContracts";

import { getHorizonServer } from "../providers/stellarConnection";
import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import { resolveStellarCosigner } from "../signer/stellarCosignerFactory";
import type { CompassStellarCosigner } from "../signer/stellarCosignerContracts";
import { runStellarGuard } from "../demo/stellarGuardPipeline";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import type { CompassPolicy } from "@shared/policyContracts";

/**
 * Compass-executed Stellar mutations for the proxy (Privy co-signing path).
 *
 * For recognized mutating tools the proxy does NOT forward to the self-signing
 * downstream. Instead Compass builds the transaction from the Privy server
 * wallet, runs it through the guard (decode -> policy), and on ALLOW co-signs
 * with Privy and submits. The result carries a `compassSigner: "privy"` marker
 * so the dashboard can show that Privy signed.
 */

const COMPASS_EXECUTED_TOOLS = new Set(["stellar_payment"]);

export function isCompassExecutedStellarTool(toolName: string): boolean {
	return COMPASS_EXECUTED_TOOLS.has(toolName);
}

type AccountFacts = { sequence: string; medThreshold: number };

export type StellarExecuteDeps = {
	env?: Record<string, string | undefined>;
	cosigner?: CompassStellarCosigner;
	loadAccount?: (address: string) => Promise<AccountFacts>;
	submit?: (signedXdr: string) => Promise<{ hash: string }>;
	knownRecipients?: string[];
	policy?: CompassPolicy;
};

function denyResult(toolName: string, reason: string): ProxyCallToolResult {
	return {
		outcome: "deny",
		reason: `deny: ${reason}`,
		policyDecision: { outcome: "deny", reason },
	};
}

function escalateResult(reason: string): ProxyCallToolResult {
	return {
		outcome: "require_approval",
		reason: `require_approval: ${reason}`,
		policyDecision: { outcome: "require_approval", reason },
	};
}

/**
 * Returns a dispatcher executeOverride: handles Compass-executed Stellar tools,
 * returns null for everything else (so the proxy forwards normally).
 */
export function createStellarProxyExecuteOverride(
	deps: StellarExecuteDeps = {},
): (args: {
	toolName: string;
	arguments?: Record<string, unknown>;
}) => Promise<ProxyCallToolResult | null> {
	const env = deps.env ?? process.env;

	return async (args) => {
		if (!isCompassExecutedStellarTool(args.toolName)) {
			return null;
		}

		const params = args.arguments ?? {};
		const destination = typeof params.destination === "string" ? params.destination : "";
		const amount = typeof params.amount === "string" ? params.amount : String(params.amount ?? "");
		if (!destination || !amount) {
			return denyResult(args.toolName, "stellar_payment requires destination and amount.");
		}

		const config = getStellarNetworkConfig(env);
		const cosigner = deps.cosigner ?? resolveStellarCosigner(env);
		const sourceAddress = env.COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY?.trim();
		if (!sourceAddress) {
			return denyResult(args.toolName, "No Privy wallet configured as source (COMPASS_STELLAR_PRIVY_WALLET_PUBLIC_KEY).");
		}

		const loadAccount =
			deps.loadAccount ??
			(async (address: string) => {
				const acc = await getHorizonServer().loadAccount(address);
				return {
					sequence: acc.sequenceNumber(),
					medThreshold: acc.thresholds?.med_threshold ?? 0,
				} satisfies AccountFacts;
			});

		let facts: AccountFacts;
		try {
			facts = await loadAccount(sourceAddress);
		} catch {
			return denyResult(args.toolName, `Privy source account ${sourceAddress} not found/funded on the network.`);
		}

		let envelopeXdr: string;
		try {
			envelopeXdr = new TransactionBuilder(
				new Account(sourceAddress, facts.sequence),
				{ fee: "100", networkPassphrase: config.networkPassphrase },
			)
				.addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
				.setTimeout(120)
				.build()
				.toXDR();
		} catch (error) {
			return denyResult(args.toolName, `invalid payment params: ${(error as Error).message}`);
		}

		const knownRecipients =
			deps.knownRecipients ??
			(env.COMPASS_STELLAR_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean) ?? []);

		const guard = await runStellarGuard({
			envelopeXdr,
			policy: deps.policy ?? DEFAULT_POLICY,
			cosigner,
			knownRecipients,
			threshold: facts.medThreshold,
			priorSignatureCount: 0,
		});

		if (guard.label === "DENY") {
			return denyResult(args.toolName, guard.reasons.join(", ") || "policy denied");
		}
		if (guard.label !== "ALLOW" || !guard.cosign.signed) {
			return escalateResult(guard.reasons.join(", ") || "requires human approval");
		}

		const submit =
			deps.submit ??
			(async (signedXdr: string) => {
				const tx = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
				const res = await getHorizonServer().submitTransaction(tx);
				return { hash: (res as { hash: string }).hash };
			});

		let txHash: string;
		try {
			({ hash: txHash } = await submit(guard.cosign.signedXdr));
		} catch (error) {
			return denyResult(args.toolName, `network submission failed: ${(error as Error).message}`);
		}

		return {
			outcome: "allow",
			reason: `allow: co-signed by Privy and submitted (${txHash}).`,
			data: {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ok: true, compassSigner: "privy", txHash }),
					},
				],
				structuredContent: { compassSigner: "privy", txHash },
			},
			policyDecision: { outcome: "allow", reason: "co-signed by Privy" },
		};
	};
}
