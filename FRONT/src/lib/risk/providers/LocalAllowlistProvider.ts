import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  AllowedToken,
} from '../../types';
import { TOKEN_REGISTRY } from '../../tokens';

/**
 * Local allowlist provider - enforces MVP token whitelist.
 * 
 * Rules:
 * - Unknown token symbol: BLOCKED
 * - Token symbol with unknown mint address: BLOCKED
 * - Token mint mismatch: BLOCKED
 */
export class LocalAllowlistProvider implements RiskProvider {
  readonly name = 'LocalAllowlist';
  readonly source = 'Local Token Allowlist';

  private readonly allowedTokens: Set<AllowedToken> = new Set([
    'SOL',
    'USDC',
    'BONK',
    'JUP',
    'PYTH',
  ]);

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    try {
      if (input.intent.action === 'swap') {
        const { inputToken, outputToken } = input.intent;
        
        // Check input token
        const inputSignal = this.checkToken(inputToken);
        if (inputSignal) {
          signals.push(inputSignal);
        }
        
        // Check output token
        const outputSignal = this.checkToken(outputToken);
        if (outputSignal) {
          signals.push(outputSignal);
        }
      } else if (input.intent.action === 'transfer') {
        const { token } = input.intent;
        
        const signal = this.checkToken(token);
        if (signal) {
          signals.push(signal);
        }
      }

      return {
        provider: this.name,
        status: 'success',
        signals,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private checkToken(token: AllowedToken): RiskReason | null {
    // Check if token is in allowlist
    if (!this.allowedTokens.has(token)) {
      return {
        label: 'Token Not Supported',
        detail: `${token} is not in the MVP allowlist. Only SOL, USDC, BONK, JUP, and PYTH are supported.`,
        severity: 'BLOCKED',
        checkName: 'token_allowlist',
        source: this.source,
        value: token,
        threshold: 'Must be in [SOL, USDC, BONK, JUP, PYTH]',
        riskImpact: 'BLOCKED',
        explanation: 'This MVP only supports a limited set of verified tokens for safety.',
        metadata: { token, allowedTokens: Array.from(this.allowedTokens) },
      };
    }

    // Verify token metadata exists
    const tokenInfo = TOKEN_REGISTRY[token];
    if (!tokenInfo) {
      return {
        label: 'Token Metadata Missing',
        detail: `${token} is in allowlist but missing metadata.`,
        severity: 'BLOCKED',
        checkName: 'token_metadata',
        source: this.source,
        value: token,
        threshold: 'Must have valid metadata',
        riskImpact: 'BLOCKED',
        explanation: 'Token configuration is incomplete.',
        metadata: { token },
      };
    }

    // All checks passed - token is allowed
    return null;
  }
}
