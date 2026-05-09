import type {
  AllowedToken,
  RiskLevel,
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
} from '../../types';
import { TOKEN_REGISTRY } from '../../tokens';
import { MockRiskScoreProvider } from './MockRiskScoreProvider';

type RiskScoreResponse = {
  score?: number;
  normalizedScore?: number;
  riskScore?: number;
  level?: string;
  rating?: string;
  status?: string;
  labels?: string[];
  warnings?: string[];
  rugIndicators?: string[];
};

/**
 * External risk score provider (Solana Tracker / RugCheck style) with mock fallback.
 * 
 * Calls the BACK service, which proxies the configured external risk API
 * without exposing API keys in the browser.
 * 
 * Falls back to MockRiskScoreProvider when:
 * - BACK is not running or the upstream API is not configured
 * - API request fails (returns 'unavailable' signal or mock data)
 * 
 * Unavailable/mock data ensures the app continues to work when external risk
 * services are down or not configured. Mock signals are labeled with isMock:true.
 */
export class ExternalRiskScoreProvider implements RiskProvider {
  readonly name = 'ExternalRiskScore';
  readonly source = 'External Risk Score API';

  private readonly backendUrl: string;
  private readonly mockProvider = new MockRiskScoreProvider();

  constructor() {
    this.backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
  }

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    try {
      const tokens = input.intent.action === 'swap'
        ? [input.intent.inputToken, input.intent.outputToken]
        : [input.intent.token];
      const signals: RiskReason[] = [];

      for (const token of tokens) {
        const response = await this.fetchRiskScore(TOKEN_REGISTRY[token].mint);
        if (!response) {
          // API fetch failed for this token - return unavailable signal (non-blocking)
          signals.push(this.unavailableSignal(token));
          continue;
        }
        signals.push(this.toSignal(token, response));
      }

      return { provider: this.name, status: 'success', signals };
    } catch {
      // Complete API failure - fall back to mock to keep app functional
      return this.mockProvider.assess(input);
    }
  }

  private async fetchRiskScore(mint: string): Promise<RiskScoreResponse | null> {
    const base = this.backendUrl.replace(/\/$/, '');
    const response = await fetch(`${base}/api/risk-score?mint=${encodeURIComponent(mint)}`);

    if (!response.ok) return null;
    return await response.json() as RiskScoreResponse;
  }

  private toSignal(token: AllowedToken, data: RiskScoreResponse): RiskReason {
    const labels = [...(data.labels ?? []), ...(data.warnings ?? []), ...(data.rugIndicators ?? [])];
    const text = [data.level, data.rating, data.status, ...labels].join(' ').toLowerCase();
    const score = data.normalizedScore ?? data.riskScore ?? data.score;
    let severity: RiskLevel = 'LOW';

    if (/critical|severe|rug|honeypot|blacklist/.test(text) || (score !== undefined && score < 40)) {
      severity = 'HIGH';
    } else if (/medium|warning|elevated/.test(text) || (score !== undefined && score < 70)) {
      severity = 'MEDIUM';
    }

    return {
      label: `${token} external risk score`,
      detail: severity === 'LOW'
        ? 'External risk provider did not report elevated risk.'
        : 'External token risk provider detected elevated risk.',
      severity,
      checkName: 'external_risk_score',
      source: this.source,
      value: score ?? (labels.join(', ') || data.level || 'provided'),
      threshold: 'critical/severe/rug/poor = HIGH; medium = MEDIUM',
      riskImpact: severity,
      explanation: severity === 'LOW'
        ? 'No configured external provider warning matched the risk thresholds.'
        : 'External token risk provider detected elevated risk.',
      metadata: { token, labels },
    };
  }

  private unavailableSignal(token: AllowedToken): RiskReason {
    return {
      label: `${token} external risk unavailable`,
      detail: 'External risk provider unavailable; this does not block the transaction.',
      severity: 'LOW',
      checkName: 'external_risk_score',
      source: this.source,
      value: 'unavailable',
      threshold: 'Unavailable does not block',
      riskImpact: 'LOW',
      explanation: 'External risk provider unavailable.',
      metadata: { token },
    };
  }
}
