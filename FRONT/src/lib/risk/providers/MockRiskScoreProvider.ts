import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  AllowedToken,
} from '../../types';

/**
 * Mock risk score provider for demo/fallback when external APIs are unavailable.
 * Returns deterministic demo scores clearly labeled as mock.
 */
export class MockRiskScoreProvider implements RiskProvider {
  readonly name = 'MockRiskScore';
  readonly source = 'Mock Risk Score Provider (Demo Data)';

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    try {
      if (input.intent.action === 'swap') {
        const { inputToken, outputToken } = input.intent;
        
        // Add risk score signals for each token
        signals.push(this.getMockRiskSignal(inputToken));
        if (outputToken !== inputToken) {
          signals.push(this.getMockRiskSignal(outputToken));
        }
      } else if (input.intent.action === 'transfer') {
        const { token } = input.intent;
        signals.push(this.getMockRiskSignal(token));
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

  private getMockRiskSignal(token: AllowedToken): RiskReason {
    const score = this.getMockScore(token);
    
    return {
      label: `${token} Risk Score`,
      detail: `Risk score: ${score.value}/100 (${score.rating}) - DEMO DATA`,
      severity: score.severity,
      checkName: 'external_risk_score',
      source: this.source,
      value: score.value,
      threshold: 'Poor (<40) = HIGH, Medium (40-70) = MEDIUM, Good (>70) = LOW',
      riskImpact: score.severity,
      explanation: `External risk assessment for ${token}. ${score.description}. This is demo data.`,
      isMock: true,
      metadata: {
        token,
        rating: score.rating,
      },
    };
  }

  private getMockScore(token: AllowedToken) {
    // Return deterministic demo scores per token
    switch (token) {
      case 'SOL':
        return {
          value: 95,
          rating: 'Excellent',
          severity: 'LOW' as const,
          description: 'Well-established L1 token with strong fundamentals',
        };
      case 'USDC':
        return {
          value: 98,
          rating: 'Excellent',
          severity: 'LOW' as const,
          description: 'Regulated stablecoin with strong backing',
        };
      case 'BONK':
        return {
          value: 55,
          rating: 'Medium',
          severity: 'MEDIUM' as const,
          description: 'Meme token with high volatility and community risk',
        };
      case 'JUP':
        return {
          value: 85,
          rating: 'Good',
          severity: 'LOW' as const,
          description: 'Established DEX token with solid utility',
        };
      case 'PYTH':
        return {
          value: 80,
          rating: 'Good',
          severity: 'LOW' as const,
          description: 'Oracle network token with institutional backing',
        };
      default:
        return {
          value: 50,
          rating: 'Medium',
          severity: 'MEDIUM' as const,
          description: 'Unknown token with limited data',
        };
    }
  }
}
