/** Supported token symbols for the MVP */
export type AllowedToken = 'SOL' | 'USDC' | 'BONK' | 'JUP' | 'PYTH';

/** Intent action type */
export type IntentAction = 'swap' | 'transfer';

/** Risk levels */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/** Parser confidence */
export type ParserConfidence = 'high' | 'medium' | 'low';

/** Token metadata */
export interface TokenInfo {
  symbol: AllowedToken;
  name: string;
  mint: string;
  decimals: number;
  coingeckoId: string;
  /** Approximate USD price for demo mode */
  demoPrice: number;
}

/** Base parsed intent */
export interface ParsedIntentBase {
  action: IntentAction;
  originalText: string;
  confidence: ParserConfidence;
  timestamp: number;
}

/** Parsed swap intent */
export interface ParsedSwapIntent extends ParsedIntentBase {
  action: 'swap';
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  amount: number;
  slippage: number;
}

/** Parsed transfer intent */
export interface ParsedTransferIntent extends ParsedIntentBase {
  action: 'transfer';
  token: AllowedToken;
  amount: number;
  recipient: string;
}

/** Union of all parsed intents */
export type ParsedIntent = ParsedSwapIntent | ParsedTransferIntent;

/** Parse error when intent cannot be resolved */
export interface ParseError {
  type: 'unsupported_token' | 'invalid_amount' | 'invalid_address' | 'ambiguous' | 'unsupported_action' | 'parse_failure';
  message: string;
  originalText: string;
}

/** Result of parsing */
export type ParseResult =
  | { ok: true; intent: ParsedIntent }
  | { ok: false; error: ParseError };

/** Risk assessment reason with enhanced provenance */
export interface RiskReason {
  label: string;
  detail: string;
  severity: RiskLevel;
  /** Name of the check/provider that generated this signal */
  checkName: string;
  /** Source/tool used (e.g., 'Birdeye API', 'Mock Provider', 'Local Allowlist') */
  source: string;
  /** The actual value observed */
  value: string | number | boolean | null;
  /** The threshold that determines risk */
  threshold: string;
  /** The risk impact level */
  riskImpact: RiskLevel;
  /** Human-readable explanation */
  explanation: string;
  /** Flag indicating this is mock/demo data */
  isMock?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Full risk assessment */
export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
  /** Alias for backward compatibility */
  signals?: RiskReason[];
  recommendation: string;
  requiresConfirmation: boolean;
  confirmationPhrase?: string;
  /** Results from individual providers */
  providerResults?: RiskProviderResult[];
}

/** Demo swap quote */
export interface SwapQuote {
  inputToken: AllowedToken;
  outputToken: AllowedToken;
  inputAmount: number;
  estimatedOutput: number;
  priceImpact: number;
  slippage: number;
  route: string;
  provider: string;
  networkFeeEstimate: number;
  exchangeRate: number;
}

/** Transfer preview */
export interface TransferPreview {
  token: AllowedToken;
  amount: number;
  sender: string;
  recipient: string;
  networkFeeEstimate: number;
}

/** Transaction preview union */
export type TransactionPreview =
  | { type: 'swap'; quote: SwapQuote; intent: ParsedSwapIntent }
  | { type: 'transfer'; preview: TransferPreview; intent: ParsedTransferIntent };

/** Transaction status */
export type TransactionStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed' | 'cancelled';

/** Transaction receipt from Helius or basic */
export interface TransactionReceipt {
  signature: string;
  timestamp: number;
  status: 'success' | 'failed';
  fee?: number;
  explorerUrl: string;
  /** Enhanced data from Helius if available */
  type?: string;
  tokenTransfers?: Array<{
    mint: string;
    amount: number;
    from: string;
    to: string;
  }>;
  nativeTransfers?: Array<{
    amount: number;
    from: string;
    to: string;
  }>;
  /** Flag indicating this is basic/fallback receipt */
  isBasic?: boolean;
}

/** History entry stored in localStorage */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  originalText: string;
  action: IntentAction;
  riskLevel: RiskLevel;
  status: TransactionStatus;
  txSignature?: string;
  details: string;
  /** Optional transaction receipt */
  receipt?: TransactionReceipt;
}

/** App flow state */
export type AppFlowState =
  | 'idle'
  | 'parsing'
  | 'parsed'
  | 'previewing'
  | 'reviewing'
  | 'confirming'
  | 'signing'
  | 'success'
  | 'error';

// ========== Provider-Based Risk Engine Types ==========

/** Token security data from providers like Birdeye */
export interface TokenSecurityData {
  mint: string;
  symbol: string;
  createdAt?: number;
  liquidity?: number;
  holderCount?: number;
  topHolderConcentration?: number;
  isVerified?: boolean;
  hasMintAuthority?: boolean;
  hasFreezeAuthority?: boolean;
  isMutableMetadata?: boolean;
  /** Additional security flags */
  metadata?: Record<string, unknown>;
}

/** Liquidity data */
export interface LiquidityData {
  totalLiquidity: number;
  source: string;
  timestamp: number;
}

/** Quote risk data from Jupiter or similar */
export interface QuoteRiskData {
  priceImpactPct: number;
  hasRoute: boolean;
  outputAmount: number;
  slippagePct: number;
  route?: string;
  venue?: string;
}

/** Recipient validation data */
export interface RecipientRiskData {
  address: string;
  isValid: boolean;
  isKnownContact: boolean;
  isSnsResolved?: boolean;
  snsName?: string;
}

/** Simulation risk data */
export interface SimulationRiskData {
  success: boolean;
  error?: string;
  balanceChanges?: Array<{
    account: string;
    before: number;
    after: number;
    mint?: string;
  }>;
  logs?: string[];
}

/** Input to risk providers */
export interface RiskProviderInput {
  intent: ParsedIntent;
  quote?: SwapQuote;
  preparedTransaction?: unknown; // Could be Transaction from @solana/web3.js
  userPublicKey?: string;
  connection?: unknown; // Could be Connection from @solana/web3.js
}

/** Result from a risk provider */
export interface RiskProviderResult {
  /** Provider name */
  provider: string;
  /** Status of the assessment */
  status: 'success' | 'unavailable' | 'failed';
  /** Risk signals generated */
  signals?: RiskReason[];
  /** Error message if failed */
  error?: string;
  /** Raw data for debugging */
  rawData?: unknown;
}

/** Risk provider interface */
export interface RiskProvider {
  readonly name: string;
  readonly source: string;
  assess(input: RiskProviderInput): Promise<RiskProviderResult>;
}
