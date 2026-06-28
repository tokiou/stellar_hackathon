import {
	Account,
	Asset,
	FeeBumpTransaction,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";

import type { ProxyCallToolResult } from "@back/services/mcp/proxy/mcpProxyContracts";
import { DEFAULT_POLICY } from "@hosted/policy/defaultPolicy";
import type { CompassPolicy } from "@shared/policyContracts";

import { getHorizonServer } from "../providers/stellarConnection";
import { getStellarNetworkConfig } from "../providers/stellarNetworkConfig";
import { runStellarGuard } from "../guard/stellarGuardPipeline";
import {
	createAgentPrivySigner,
	type AgentPrivySigner,
} from "../signer/privyAgentSigner";
import { resolveStellarCosigner } from "../signer/stellarCosignerFactory";
import type { CompassStellarCosigner } from "../signer/stellarCosignerContracts";

/**
 * Official Compass co-signing for the proxy — native Stellar 2-of-2 multisig.
 *
 * The account is 2-of-2: the AGENT (master, weight 1) and COMPASS (weight 1),
 * medium threshold 2. Both keys are Privy server wallets (TEE):
 *   - the agent's key is provisioned by Privy onboarding (the agent's identity);
 *   - Compass's key co-signs ONLY on policy ALLOW.
 * The ledger itself requires both signatures — enforcement is cryptographic,
 * non-custodial and non-bypassable.
 *
 * Two ways an action reaches Compass:
 *   1. INTENT  — the agent calls `stellar_payment {destination, amount}`. The
 *      proxy builds the payment from the agent's account, signs it with the
 *      AGENT's Privy wallet (first signature), runs policy, and on ALLOW adds
 *      Compass's signature (second) and submits.
 *   2. ENVELOPE — the agent already signed a transaction elsewhere and presents
 *      `envelopeXdr`; Compass verifies the agent's signature, runs policy, and
 *      co-signs on ALLOW.
 *
 * Decision contract maps onto the signature:
 *   ALLOW    -> Compass signs  -> 2-of-2 met -> executes on testnet
 *   DENY     -> Compass refuses -> threshold unmet -> tx is dead
 *   ESCALATE -> Compass holds   -> awaits a human
 *
 * Anything that tries to self-sign (a raw secret key in args) is BLOCKED —
 * never forwarded to a self-signing downstream.
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

/** Payment-style intents the proxy can BUILD itself from {destination, amount}. */
const PAYMENT_INTENT_HINT = /payment|transfer|send|pay/i;

type SubmitFn = (signedXdr: string) => Promise<{ hash: string }>;

/** Minimal account facts needed to BUILD a payment from the agent's account. */
type LoadAccountFn = (address: string) => Promise<{ sequence: string }>;

export type StellarExecuteDeps = {
	env?: Record<string, string | undefined>;
	cosigner?: CompassStellarCosigner;
	/** The agent's Privy signer (its provisioned Stellar keypair). */
	agentSigner?: AgentPrivySigner;
	/** Loads the agent account sequence to build the payment (defaults to Horizon). */
	loadAccount?: LoadAccountFn;
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

		// Anti-bypass: never accept a raw secret key — Compass co-signs, it does
		// not custody the agent's key, and the agent must sign via its own wallet.
		if (hasRawKeyArg(args.arguments)) {
			return denyResult(
				args.toolName,
				"refusing a self-signing call (raw secret key in args). The agent signs with its own (Privy-provisioned) wallet and Compass co-signs.",
			);
		}

		const envelopeXdr = getEnvelopeXdr(args.arguments);

		// 1) Agent already signed elsewhere -> verify + co-sign the envelope.
		if (envelopeXdr) {
			return cosignAgentTransaction(args.toolName, envelopeXdr, deps, env);
		}

		// 2) Payment intent -> build it, sign with the agent's Privy wallet, co-sign.
		if (PAYMENT_INTENT_HINT.test(args.toolName)) {
			return buildAgentSignAndCosign(args.toolName, args.arguments, deps, env);
		}

		// 3) Other fund-moving / authority ops without an envelope: we cannot build
		// them safely from loose args — require an agent-signed envelopeXdr.
		if (FUND_MOVING_TOOL_HINT.test(args.toolName)) {
			return denyResult(
				args.toolName,
				`${args.toolName} changes authority / moves funds. Present an agent-signed transaction (envelopeXdr) so Compass can co-sign on ALLOW.`,
			);
		}

		// 4) Read-only / unrelated -> forward to the downstream.
		return null;
	};
}

/**
 * INTENT path: build a native payment from the agent's account, sign it with
 * the agent's Privy wallet (first signature), then run policy + Compass co-sign.
 */
async function buildAgentSignAndCosign(
	toolName: string,
	args: Record<string, unknown> | undefined,
	deps: StellarExecuteDeps,
	env: Record<string, string | undefined>,
): Promise<ProxyCallToolResult> {
	let passphrase: string;
	try {
		passphrase = getStellarNetworkConfig(env).networkPassphrase;
	} catch (error) {
		return denyResult(toolName, (error as Error).message);
	}

	const agentSigner = deps.agentSigner ?? createAgentPrivySigner({ env });
	const agentPublicKey = agentSigner.getPublicKey();
	if (!agentPublicKey) {
		return denyResult(
			toolName,
			"agent wallet is not configured. Provision the agent's Stellar keypair via Privy onboarding (COMPASS_STELLAR_AGENT_PRIVY_WALLET_ID/_PUBLIC_KEY), or present an agent-signed envelopeXdr.",
		);
	}

	const destination =
		typeof args?.destination === "string" ? args.destination.trim() : "";
	const amount = typeof args?.amount === "string" ? args.amount.trim() : "";
	if (!destination || !amount) {
		return denyResult(toolName, "payment requires both `destination` and `amount`.");
	}

	const loadAccount: LoadAccountFn =
		deps.loadAccount ??
		(async (address) => {
			const acc = await getHorizonServer().loadAccount(address);
			return { sequence: acc.sequenceNumber() };
		});

	let sequence: string;
	try {
		({ sequence } = await loadAccount(agentPublicKey));
	} catch (error) {
		return denyResult(
			toolName,
			`could not load the agent account ${agentPublicKey}: ${(error as Error).message}`,
		);
	}

	let agentSignedXdr: string;
	try {
		const tx = new TransactionBuilder(new Account(agentPublicKey, sequence), {
			fee: "100",
			networkPassphrase: passphrase,
		})
			.addOperation(
				Operation.payment({ destination, asset: Asset.native(), amount }),
			)
			.setTimeout(120)
			.build();
		// FIRST signature: the agent, via its own Privy-provisioned wallet.
		agentSignedXdr = await agentSigner.sign(tx.toXDR());
	} catch (error) {
		return denyResult(toolName, `agent signing failed: ${(error as Error).message}`);
	}

	// Hand off to the shared co-sign path (2-of-2 verification + policy + Privy).
	return cosignAgentTransaction(toolName, agentSignedXdr, deps, env);
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

	// Enforce that the account is genuinely 2-of-2 with Compass as a required
	// signer — otherwise co-signing gives no guarantee (a single signer could
	// move funds). Weight-1 model: Compass must be a signer AND threshold >= 2.
	let account: import("@shared/chainContracts").AccountSignerState;
	try {
		account = await cosigner.inspectAccount(sourceAddress);
	} catch (error) {
		return denyResult(toolName, `could not read source account: ${(error as Error).message}`);
	}
	if (!account.exists) {
		return denyResult(toolName, `source account ${sourceAddress} not found on-chain.`);
	}
	const compassKey = cosigner.getPublicKey();
	if (!compassKey || !(account.signers ?? []).includes(compassKey)) {
		return denyResult(
			toolName,
			"account is not configured with Compass as a required signer; refusing to co-sign (not a 2-of-2 Compass-guarded account).",
		);
	}
	const threshold = account.threshold;
	if (typeof threshold !== "number" || threshold < 2) {
		return denyResult(
			toolName,
			"account threshold is below 2; a single signer could move funds. Configure 2-of-2 (agent + Compass) before co-signing.",
		);
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
