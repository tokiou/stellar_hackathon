import { PublicKey } from '@solana/web3.js';
import type {
  ParseResult,
  ParsedSwapIntent,
  ParsedTransferIntent,
  AllowedToken,
  ParserConfidence,
} from './types';
import { isAllowedToken, ALLOWED_SYMBOLS } from './tokens';

/** Default slippage for swaps */
const DEFAULT_SLIPPAGE = 1;

/**
 * Deterministic intent parser.
 * Does NOT rely on LLM. Extracts structured data from natural language using regex patterns.
 */
export function parseIntent(input: string): ParseResult {
  const text = input.trim();

  if (!text) {
    return {
      ok: false,
      error: {
        type: 'parse_failure',
        message: 'Please enter a transaction intent.',
        originalText: text,
      },
    };
  }

  // Try transfer first (more specific pattern)
  const transferResult = tryParseTransfer(text);
  if (transferResult) return transferResult;

  // Try swap
  const swapResult = tryParseSwap(text);
  if (swapResult) return swapResult;

  // Check for unsupported actions
  const unsupportedActions = [
    'stake', 'unstake', 'lend', 'borrow', 'bridge', 'nft', 'mint',
    'dca', 'limit', 'leverage', 'short', 'long', 'yield', 'farm',
  ];
  const lower = text.toLowerCase();
  for (const action of unsupportedActions) {
    if (lower.includes(action)) {
      return {
        ok: false,
        error: {
          type: 'unsupported_action',
          message: `"${action}" is not supported in this MVP. Only swaps and transfers are available.`,
          originalText: text,
        },
      };
    }
  }

  return {
    ok: false,
    error: {
      type: 'parse_failure',
      message: 'Could not understand this intent. Try: "Swap 0.1 SOL to USDC" or "Send 5 USDC to <address>".',
      originalText: text,
    },
  };
}

/**
 * Attempt to parse a transfer intent.
 * Patterns:
 *   "Send 5 USDC to <address>"
 *   "Transfer 0.01 SOL to <address>"
 */
function tryParseTransfer(text: string): ParseResult | null {
  // Pattern: (send|transfer) <amount> <token> to <address>
  const pattern = /(?:send|transfer)\s+([\d.]+)\s+([a-zA-Z]+)\s+to\s+([a-zA-Z0-9]+)/i;
  const match = text.match(pattern);

  if (!match) return null;

  const amountStr = match[1];
  const tokenStr = match[2].toUpperCase();
  const recipient = match[3];

  // Validate token
  if (!isAllowedToken(tokenStr)) {
    const found = findMentionedUnsupportedToken(text);
    return {
      ok: false,
      error: {
        type: 'unsupported_token',
        message: `This MVP only supports ${ALLOWED_SYMBOLS.join(', ')}. "${found || tokenStr}" is not supported. Unsupported tokens are blocked for safety.`,
        originalText: text,
      },
    };
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return {
      ok: false,
      error: {
        type: 'invalid_amount',
        message: 'Amount must be a positive number.',
        originalText: text,
      },
    };
  }

  // Validate address
  if (!isValidSolanaAddress(recipient)) {
    return {
      ok: false,
      error: {
        type: 'invalid_address',
        message: `"${truncateAddress(recipient)}" is not a valid Solana public key.`,
        originalText: text,
      },
    };
  }

  const confidence = determineTransferConfidence(amount, tokenStr as AllowedToken);

  const intent: ParsedTransferIntent = {
    action: 'transfer',
    token: tokenStr as AllowedToken,
    amount,
    recipient,
    originalText: text,
    confidence,
    timestamp: Date.now(),
  };

  return { ok: true, intent };
}

/**
 * Attempt to parse a swap intent.
 * Patterns:
 *   "Swap 0.1 SOL to USDC"
 *   "Buy 0.05 SOL of BONK"
 *   "Convert 10 USDC to JUP"
 *   "Exchange 5 USDC for SOL"
 */
function tryParseSwap(text: string): ParseResult | null {
  // Pattern 1: (swap|convert|exchange) <amount> <token> (to|for|into) <token>
  const pattern1 = /(?:swap|convert|exchange)\s+([\d.]+)\s+([a-zA-Z]+)\s+(?:to|for|into)\s+([a-zA-Z]+)/i;

  // Pattern 2: buy <amount> <token> of <token>  (means "use <amount> of <inputToken> to buy <outputToken>")
  const pattern2 = /(?:buy)\s+([\d.]+)\s+([a-zA-Z]+)\s+(?:of|worth\s+of)\s+([a-zA-Z]+)/i;

  // Pattern 3: buy <token> with <amount> <token>
  const pattern3 = /(?:buy)\s+([a-zA-Z]+)\s+with\s+([\d.]+)\s+([a-zA-Z]+)/i;

  let amountStr: string;
  let inputTokenStr: string;
  let outputTokenStr: string;

  const match1 = text.match(pattern1);
  const match2 = text.match(pattern2);
  const match3 = text.match(pattern3);

  if (match1) {
    amountStr = match1[1];
    inputTokenStr = match1[2].toUpperCase();
    outputTokenStr = match1[3].toUpperCase();
  } else if (match2) {
    // "Buy 0.05 SOL of BONK" => use 0.05 SOL to buy BONK
    amountStr = match2[1];
    inputTokenStr = match2[2].toUpperCase();
    outputTokenStr = match2[3].toUpperCase();
  } else if (match3) {
    // "Buy JUP with 10 USDC"
    amountStr = match3[2];
    inputTokenStr = match3[3].toUpperCase();
    outputTokenStr = match3[1].toUpperCase();
  } else {
    return null;
  }

  // Validate tokens
  for (const tok of [inputTokenStr, outputTokenStr]) {
    if (!isAllowedToken(tok)) {
      return {
        ok: false,
        error: {
          type: 'unsupported_token',
          message: `This MVP only supports ${ALLOWED_SYMBOLS.join(', ')}. "${tok}" is not supported. Unsupported tokens are blocked for safety.`,
          originalText: text,
        },
      };
    }
  }

  if (inputTokenStr === outputTokenStr) {
    return {
      ok: false,
      error: {
        type: 'parse_failure',
        message: 'Input and output tokens cannot be the same.',
        originalText: text,
      },
    };
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return {
      ok: false,
      error: {
        type: 'invalid_amount',
        message: 'Amount must be a positive number.',
        originalText: text,
      },
    };
  }

  const confidence = determineSwapConfidence(amount, inputTokenStr as AllowedToken, outputTokenStr as AllowedToken);

  const intent: ParsedSwapIntent = {
    action: 'swap',
    inputToken: inputTokenStr as AllowedToken,
    outputToken: outputTokenStr as AllowedToken,
    amount,
    slippage: DEFAULT_SLIPPAGE,
    originalText: text,
    confidence,
    timestamp: Date.now(),
  };

  return { ok: true, intent };
}

function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBytes());
  } catch {
    // Some valid addresses might not be on curve (PDAs), so also check base58 format
    try {
      new PublicKey(address);
      return address.length >= 32 && address.length <= 44;
    } catch {
      return false;
    }
  }
}

function determineSwapConfidence(
  amount: number,
  inputToken: AllowedToken,
  outputToken: AllowedToken,
): ParserConfidence {
  // Simple heuristic
  if (amount > 0 && isAllowedToken(inputToken) && isAllowedToken(outputToken)) {
    return 'high';
  }
  return 'medium';
}

function determineTransferConfidence(
  amount: number,
  token: AllowedToken,
): ParserConfidence {
  if (amount > 0 && isAllowedToken(token)) {
    return 'high';
  }
  return 'medium';
}

function findMentionedUnsupportedToken(text: string): string | null {
  const words = text.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z]/g, '').toUpperCase();
    if (clean.length >= 2 && clean.length <= 10 && !isAllowedToken(clean)) {
      // Check if it looks like a token (all caps, short)
      if (clean === word.replace(/[^a-zA-Z]/g, '').toUpperCase()) {
        return clean;
      }
    }
  }
  return null;
}

function truncateAddress(addr: string): string {
  if (addr.length > 12) {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }
  return addr;
}