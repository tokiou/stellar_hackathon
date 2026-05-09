import type {
  AllowedToken,
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  TokenSecurityData,
} from '../../types';
import { TOKEN_REGISTRY } from '../../tokens';
import { MockTokenSecurityProvider } from './MockTokenSecurityProvider';

type BirdeyeSecurityResponse = Partial<TokenSecurityData> & {
  data?: Partial<TokenSecurityData>;
  creationTime?: number;
  creation_time?: number;
  liquidityUsd?: number;
  liquidity_usd?: number;
  holder?: number;
  holder_count?: number;
  top10HolderPercent?: number;
  top10_holder_percent?: number;
  verified?: boolean;
  mutableMetadata?: boolean;
  mintAuthority?: boolean;
  freezeAuthority?: boolean;
};

/**
 * Birdeye token security provider with mock fallback when unavailable.
 * 
 * Calls the BACK service, which proxies Birdeye without exposing API keys
 * in the browser.
 * 
 * Falls back to MockTokenSecurityProvider when:
 * - BACK is not running or Birdeye is not configured
 * - API request fails (network error, rate limit, service unavailable)
 * 
 * Demo data is used as fallback to ensure the app remains functional when
 * the external API is unavailable, while mock signals are clearly labeled
 * with isMock:true for user transparency.
 */
export class BirdeyeTokenSecurityProvider implements RiskProvider {
  readonly name = 'BirdeyeTokenSecurity';
  readonly source = 'Birdeye Token Security API';

  private readonly backendUrl: string;
  private readonly mockProvider = new MockTokenSecurityProvider();

  constructor() {
    this.backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
  }

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    try {
      const tokens = input.intent.action === 'swap'
        ? [input.intent.inputToken, input.intent.outputToken]
        : [input.intent.token];

      return await this.assessTokens(tokens);
    } catch {
      // API call failed - fall back to mock to keep app functional
      // Network errors, rate limits, or service outages won't block the user
      return this.mockProvider.assess(input);
    }
  }

  private async assessTokens(tokens: AllowedToken[]): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    for (const token of tokens) {
      const tokenInfo = TOKEN_REGISTRY[token];
      if (!tokenInfo) continue;

      const securityData = await this.fetchTokenSecurity(tokenInfo.mint);
      if (!securityData) {
        const mockResult = await this.mockProvider.assess({
          intent: {
            action: 'transfer',
            originalText: '',
            confidence: 'high',
            timestamp: Date.now(),
            token,
            amount: 1,
            recipient: '',
          },
        });
        signals.push(...(mockResult.signals ?? []));
        continue;
      }

      signals.push(...this.analyzeSecurityData(token, this.normalizeSecurityData(token, securityData)));
    }

    return { provider: this.name, status: 'success', signals };
  }

  private async fetchTokenSecurity(mint: string): Promise<BirdeyeSecurityResponse | null> {
    const base = this.backendUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/birdeye/token-security?mint=${encodeURIComponent(mint)}`);

    if (!response.ok) return null;
    const body = await response.json() as BirdeyeSecurityResponse;
    return body.data ? { ...body, ...body.data } : body;
  }

  private normalizeSecurityData(token: AllowedToken, data: BirdeyeSecurityResponse): TokenSecurityData {
    return {
      mint: TOKEN_REGISTRY[token].mint,
      symbol: token,
      createdAt: data.createdAt ?? data.creationTime ?? data.creation_time,
      liquidity: data.liquidity ?? data.liquidityUsd ?? data.liquidity_usd,
      holderCount: data.holderCount ?? data.holder ?? data.holder_count,
      topHolderConcentration: data.topHolderConcentration ?? data.top10HolderPercent ?? data.top10_holder_percent,
      isVerified: data.isVerified ?? data.verified,
      hasMintAuthority: data.hasMintAuthority ?? data.mintAuthority,
      hasFreezeAuthority: data.hasFreezeAuthority ?? data.freezeAuthority,
      isMutableMetadata: data.isMutableMetadata ?? data.mutableMetadata,
      metadata: data.metadata,
    };
  }

  private analyzeSecurityData(token: AllowedToken, data: TokenSecurityData): RiskReason[] {
    const signals: RiskReason[] = [];

    if (data.createdAt) {
      const ageHours = (Date.now() - data.createdAt) / (1000 * 60 * 60);
      if (ageHours < 1) {
        signals.push(this.signal(token, 'Token very new', 'token_age', ageHours, '< 1h = HIGH, < 24h = MEDIUM', 'HIGH', 'Extremely new tokens are high risk.'));
      } else if (ageHours < 24) {
        signals.push(this.signal(token, 'Token new', 'token_age', ageHours, '< 1h = HIGH, < 24h = MEDIUM', 'MEDIUM', 'New tokens carry elevated risk.'));
      }
    }

    if (data.liquidity !== undefined) {
      if (data.liquidity < 5_000) {
        signals.push(this.signal(token, 'Very low liquidity', 'liquidity', data.liquidity, '< $5k = HIGH, < $50k = MEDIUM', 'HIGH', 'Very low liquidity can cause severe slippage or inability to exit.'));
      } else if (data.liquidity < 50_000) {
        signals.push(this.signal(token, 'Low liquidity', 'liquidity', data.liquidity, '< $5k = HIGH, < $50k = MEDIUM', 'MEDIUM', 'Low liquidity can lead to higher slippage.'));
      }
    }

    if (data.holderCount !== undefined && data.holderCount < 100) {
      signals.push(this.signal(token, 'Low holder count', 'holder_count', data.holderCount, '< 100 = MEDIUM', 'MEDIUM', 'Low holder count indicates limited distribution.'));
    }

    if (data.topHolderConcentration !== undefined) {
      if (data.topHolderConcentration > 70) {
        signals.push(this.signal(token, 'Extreme holder concentration', 'holder_concentration', data.topHolderConcentration, '> 70% = HIGH, > 30% = MEDIUM', 'HIGH', 'One holder controls most supply.'));
      } else if (data.topHolderConcentration > 30) {
        signals.push(this.signal(token, 'High holder concentration', 'holder_concentration', data.topHolderConcentration, '> 70% = HIGH, > 30% = MEDIUM', 'MEDIUM', 'Concentrated ownership increases risk.'));
      }
    }

    if (data.isVerified === false) {
      signals.push(this.signal(token, 'Token not verified', 'verification', false, 'Verified preferred', 'MEDIUM', 'Unverified tokens carry higher risk.'));
    }

    if (data.hasFreezeAuthority) {
      signals.push(this.signal(token, 'Freeze authority enabled', 'freeze_authority', true, 'Disabled preferred', 'HIGH', 'Freeze authority can restrict token movement.'));
    } else if (data.hasMintAuthority) {
      signals.push(this.signal(token, 'Mint authority enabled', 'mint_authority', true, 'Disabled preferred', 'MEDIUM', 'Mint authority can dilute supply.'));
    }

    if (signals.length === 0) {
      signals.push(this.signal(token, 'Token security check passed', 'token_security', 'passed', 'No triggered risk indicators', 'LOW', 'No configured token security risk indicators were detected.'));
    }

    return signals;
  }

  private signal(
    token: AllowedToken,
    label: string,
    checkName: string,
    value: string | number | boolean,
    threshold: string,
    severity: RiskReason['severity'],
    explanation: string,
  ): RiskReason {
    return {
      label: `${token} ${label}`,
      detail: explanation,
      severity,
      checkName,
      source: this.source,
      value,
      threshold,
      riskImpact: severity,
      explanation,
      metadata: { token },
    };
  }
}
