import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";

import type { ProxyCallToolResult } from "@back/services/mcp/proxy/mcpProxyContracts";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import type { CompassPolicy } from "@shared/policyContracts";

import { getHorizonServer } from "../providers/stellarConnection";
import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import { runStellarGuard } from "../guard/stellarGuardPipeline";
import { resolveStellarCosigner } from "../signer/stellarCosignerFactory";
import type { CompassStellarCosigner } from "../signer/stellarCosignerContracts";

/**
 * Official Compass co-signing for the proxy.
 *
 * Compass is a CO-SIGNER, not a custodian of the agent's key. The agent builds
 * and signs a transaction with ITS OWN wallet (a key Compass never sees) on a
 * multisig account where Compass is a required signer, then presents the signed
 * transaction (`envelopeXdr`). Compass decodes it, runs policy, and — only on
 * ALLOW — adds its OWN signature (via Privy) and submits. Without Compass's
 * signature the account threshold is unmet and the network rejects it.
 *
 * Anything that tries to self-sign (a raw secret key in args) or to move funds
 * without presenting an agent-signed transaction is BLOCKED — never forwarded
 * to a self-signing downstream.
 */

const RAW_KEY_ARG_NAMES = [
	"secretKey",
	"secret_key",
	"seed",
	"privateKey",
	"private_key",
	"issuerSecretKey",
	"distributorSecretKey",
];

const ENVELOPE_ARG_NAMES = [
	"envelopeXdr",
	"envelope_xdr",
	"signedXdr",
	"signed_xdr",
	"transactionXdr",
	"transaction_xdr",
	"xdr",
];

/** Tool names that move funds / change authority and must be co-signed, not forwarded. */
const FUND_MOVING_TOOL_HINT =
	/payment|transfer|send|pay|change_?trust|create_?account|create_?asset|claim|manage_?(sell|buy)_?offer|set_?options|deploy/i;

type SubmitFn = (signedXdr: string) => Promise<{ hash: string }>;

export type StellarExecuteDeps = {
	env?: Record<string, string | undefined>;
	cosigner?: CompassStellarCosigner;
	submit?: SubmitFn;
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

function hasRawKeyArg(args?: Record<string, unknown>): boolean {
	if (!args) return false;
	return RAW_KEY_ARG_NAMES.some(
		(name) => typeof args[name] === "string" && (args[name] as string).length > 0,
	);
}

function getEnvelopeXdr(args?: Record<string, unknown>): string | null {
	if (!args) return null;
	for (const name of ENVELOPE_ARG_NAMES) {
		const value = args[name];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

/**
 * Returns a dispatcher executeOverride. It handles agent-signed transactions
 * (co-sign + submit) and blocks self-signing / unsigned fund-moving calls;
 * read-only and unrelated tools fall through (return null -> forwarded).
 */
export function createStellarProxyExecuteOverride(
	deps: StellarExecuteDeps = {},
): (args: {
	toolName: string;
	arguments?: Record<string, unknown>;
}) => Promise<ProxyCallToolResult | null> {
	const env = deps.env ?? process.env;

	return async (args) => {
		// Scope: this override is the STELLAR firewall. Non-Stellar downstream
		// tools fall through to the normal proxy gate (return null).
		if (!/^(stellar_|soroban_)/i.test(args.toolName)) {
			return null;
		}

		const envelopeXdr = getEnvelopeXdr(args.arguments);

		// 1) Agent-signed transaction presented for co-signing.
		if (envelopeXdr) {
			return cosignAgentTransaction(args.toolName, envelopeXdr, deps, env);
		}

		// 2) Anti-bypass: never forward a self-signing / unsigned fund-moving call.
		if (hasRawKeyArg(args.arguments)) {
			return denyResult(
				args.toolName,
				"refusing a self-signing call (raw secret key in args). Sign with the agent's own wallet and present the signed transaction for Compass to co-sign.",
			);
		}
		if (FUND_MOVING_TOOL_HINT.test(args.toolName)) {
			return denyResult(
				args.toolName,
				`${args.toolName} moves funds / changes authority. Present an agent-signed transaction (envelopeXdr) so Compass can co-sign on ALLOW; build-and-self-sign is blocked.`,
			);
		}

		// 3) Read-only / unrelated -> forward to the downstream.
		return null;
	};
}

async function cosignAgentTransaction(
	toolName: string,
	envelopeXdr: string,
	deps: StellarExecuteDeps,
	env: Record<string, string | undefined>,
): Promise<ProxyCallToolResult> {
	let passphrase: string;
	try {
		passphrase = getStellarNetworkConfig(env).networkPassphrase;
	} catch (error) {
		return denyResult(toolName, (error as Error).message);
	}

	let cosigner: CompassStellarCosigner;
	try {
		cosigner = deps.cosigner ?? resolveStellarCosigner(env);
	} catch (error) {
		// e.g. PRIVY_REQUIRED — deny cleanly instead of crashing the proxy.
		return denyResult(toolName, (error as Error).message);
	}

	// Parse to count the agent's signatures and read the source account.
	let priorSignatureCount: number;
	let sourceAddress: string;
	try {
		const parsed = TransactionBuilder.fromXDR(envelopeXdr, passphrase);
		const tx = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
		priorSignatureCount = tx.signatures.length;
		sourceAddress = tx.source;
	} catch (error) {
		return denyResult(toolName, `malformed transaction XDR: ${(error as Error).message}`);
	}

	// Co-signing requires the agent to have signed first.
	if (priorSignatureCount < 1) {
		return denyResult(
			toolName,
			"transaction is not signed by the agent. Compass only CO-signs an already-signed transaction.",
		);
	}

	// Required signers (threshold) for the audit / non-executability evidence.
	let threshold: number | undefined;
	try {
		threshold = (await cosigner.inspectAccount(sourceAddress)).threshold;
	} catch {
		threshold = undefined;
	}

	const knownRecipients =
		deps.knownRecipients ??
		env.COMPASS_STELLAR_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean) ??
		[];

	const guard = await runStellarGuard({
		envelopeXdr,
		policy: deps.policy ?? DEFAULT_POLICY,
		cosigner,
		knownRecipients,
		threshold,
		priorSignatureCount,
	});

	if (guard.label === "DENY") {
		return denyResult(toolName, guard.reasons.join(", ") || "policy denied");
	}
	if (guard.label !== "ALLOW" || !guard.cosign.signed) {
		return escalateResult(guard.reasons.join(", ") || "requires human approval");
	}

	const submit: SubmitFn =
		deps.submit ??
		(async (signedXdr) => {
			const tx = TransactionBuilder.fromXDR(signedXdr, passphrase);
			const res = await getHorizonServer().submitTransaction(tx);
			return { hash: (res as { hash: string }).hash };
		});

	let txHash: string;
	try {
		({ hash: txHash } = await submit(guard.cosign.signedXdr));
	} catch (error) {
		return denyResult(toolName, `network submission failed: ${(error as Error).message}`);
	}

	const collectedSigners = priorSignatureCount + 1; // agent + Compass
	return {
		outcome: "allow",
		reason: `allow: agent-signed + Compass co-signed via Privy; submitted (${txHash}).`,
		data: {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						ok: true,
						compassSigner: "privy",
						txHash,
						collectedSigners,
						requiredSigners: threshold,
					}),
				},
			],
			structuredContent: {
				compassSigner: "privy",
				txHash,
				collectedSigners,
				requiredSigners: threshold,
			},
		},
		policyDecision: { outcome: "allow", reason: "co-signed by Privy" },
	};
}
