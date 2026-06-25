/**
 * Neutral chain seam (Stellar Wave 0).
 *
 * These are the ONLY chain-related types the Compass brain (policy engine,
 * LLM judge, sanitizer, decision contract, MCP proxy) is allowed to depend on.
 * A concrete chain (Solana today, Stellar later) is reached only through a
 * `ChainAdapter` resolved by `chainRegistry` — the brain never imports a
 * concrete chain module and never references chain-specific transaction types
 * (e.g. Solana's `VersionedTransaction`).
 */

export type ChainId = "solana" | "stellar";

/**
 * Chain-neutral view of a transaction the policy engine and judge consume.
 * Produced by `ChainAdapter.decode`; the raw opaque payload never reaches the
 * brain.
 */
export interface SemanticFacts {
	actionKind: string; // e.g. "transfer" | "swap"
	sourceAddress: string;
	recipientAddress: string;
	asset: string;
	amount: number;
	amountUsd: number;
	// Optional risk flags the policy engine may consult.
	isUnknownRecipient?: boolean;
	isHighValue?: boolean;
	riskFlags?: string[];
}

/**
 * Neutral view of an account's signing configuration. For chains with native
 * multisig (Stellar), `signers`/`threshold` describe the co-signing setup.
 */
export interface AccountSignerState {
	address: string;
	exists: boolean;
	signers?: string[];
	threshold?: number;
}

/**
 * Non-sensitive metadata recorded in the audit trail. Implementations MUST NOT
 * include raw transaction bytes, private keys, secret material, or raw prompts.
 */
export interface ChainAuditMetadata {
	chainId: ChainId;
	network: string;
	actionKind: string;
	[key: string]: unknown;
}

/**
 * The minimum a chain must provide to the brain. `decode` and
 * `buildAuditMetadata` are required (they are all the brain needs to evaluate
 * an action). `inspectAccount`/`cosign`/`submit` are optional edge concerns
 * (see docs/stellar-wave-0-chain-adapter-boundary openQuestion Q1).
 */
export interface ChainAdapter {
	readonly chainId: ChainId;
	decode(payload: string): Promise<SemanticFacts>;
	inspectAccount?(address: string): Promise<AccountSignerState>;
	cosign?(payload: string, signerRef: string): Promise<string>;
	submit?(payload: string): Promise<{ txHash: string }>;
	buildAuditMetadata(facts: SemanticFacts, result?: unknown): ChainAuditMetadata;
}
