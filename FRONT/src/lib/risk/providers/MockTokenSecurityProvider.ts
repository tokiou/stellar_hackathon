import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  AllowedToken,
} from '../../types';

/**
 * Mock token security provider for demo/fallback when Birdeye is unavailable.
 * Returns deterministic demo data clearly labeled as mock.
 */
export class MockTokenSecurityProvider implements RiskProvider {
  readonly name = 'MockTokenSecurity';
  readonly source = 'Mock Token Security Provider (Demo Data)';

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    try {
      // Generate mock security signals based on token
      if (input.intent.action === 'swap') {
        const { inputToken, outputToken } = input.intent;
        
        // Add signals for each token
        signals.push(...this.getMockTokenSignals(inputToken));
        if (outputToken !== inputToken) {
          signals.push(...this.getMockTokenSignals(outputToken));
        }
      } else if (input.intent.action === 'transfer') {
        const { token } = input.intent;
        signals.push(...this.getMockTokenSignals(token));
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

  private getMockTokenSignals(token: AllowedToken): RiskReason[] {
    const signals: RiskReason[] = [];

    // Mock data per token
    const mockData = this.getMockSecurityData(token);

    // Token age check
    if (mockData.ageHours < 24) {
      signals.push({
        label: `${token} Token Age`,
        detail: `Token created ${mockData.ageHours} hours ago (DEMO DATA)`,
        severity: mockData.ageHours < 1 ? 'HIGH' : 'MEDIUM',
        checkName: 'token_age',
        source: this.source,
        value: mockData.ageHours,
        threshold: '< 1h = HIGH, < 24h = MEDIUM',
        riskImpact: mockData.ageHours < 1 ? 'HIGH' : 'MEDIUM',
        explanation: `New tokens can be risky. This is demo data for ${token}.`,
        isMock: true,
        metadata: { token },
      });
    } else {
      signals.push({
        label: `${token} Token Age`,
        detail: `Token is ${mockData.ageDays} days old (DEMO DATA)`,
        severity: 'LOW',
        checkName: 'token_age',
        source: this.source,
        value: mockData.ageDays,
        threshold: '> 24h = LOW',
        riskImpact: 'LOW',
        explanation: `Token has existed for a reasonable time. This is demo data for ${token}.`,
        isMock: true,
        metadata: { token },
      });
    }

    // Liquidity check
    signals.push({
      label: `${token} Liquidity`,
      detail: `$${mockData.liquidity.toLocaleString()} liquidity (DEMO DATA)`,
      severity: mockData.liquidityRisk,
      checkName: 'liquidity',
      source: this.source,
      value: mockData.liquidity,
      threshold: '< $5k = HIGH, < $50k = MEDIUM, else LOW',
      riskImpact: mockData.liquidityRisk,
      explanation: `Liquidity affects slippage and exit ability. This is demo data for ${token}.`,
      isMock: true,
      metadata: { token },
    });

    // Holder concentration
    if (mockData.topHolderPct > 30) {
      signals.push({
        label: `${token} Holder Concentration`,
        detail: `Top holder owns ${mockData.topHolderPct}% (DEMO DATA)`,
        severity: mockData.topHolderPct > 70 ? 'HIGH' : 'MEDIUM',
        checkName: 'holder_concentration',
        source: this.source,
        value: mockData.topHolderPct,
        threshold: '> 70% = HIGH, > 30% = MEDIUM',
        riskImpact: mockData.topHolderPct > 70 ? 'HIGH' : 'MEDIUM',
        explanation: `High concentration means one holder controls a large supply. This is demo data for ${token}.`,
        isMock: true,
        metadata: { token },
      });
    }

    return signals;
  }

  private getMockSecurityData(token: AllowedToken) {
    // Return deterministic demo data per token
    switch (token) {
      case 'SOL':
        return {
          ageHours: 24 * 365 * 3, // 3 years
          ageDays: 365 * 3,
          liquidity: 500_000_000,
          liquidityRisk: 'LOW' as const,
          topHolderPct: 5,
          holderCount: 1_000_000,
        };
      case 'USDC':
        return {
          ageHours: 24 * 365 * 5,
          ageDays: 365 * 5,
          liquidity: 1_000_000_000,
          liquidityRisk: 'LOW' as const,
          topHolderPct: 3,
          holderCount: 2_000_000,
        };
      case 'BONK':
        return {
          ageHours: 24 * 365 * 2,
          ageDays: 365 * 2,
          liquidity: 10_000_000,
          liquidityRisk: 'LOW' as const,
          topHolderPct: 35, // Elevated concentration
          holderCount: 500_000,
        };
      case 'JUP':
        return {
          ageHours: 24 * 200,
          ageDays: 200,
          liquidity: 50_000_000,
          liquidityRisk: 'LOW' as const,
          topHolderPct: 15,
          holderCount: 300_000,
        };
      case 'PYTH':
        return {
          ageHours: 24 * 300,
          ageDays: 300,
          liquidity: 30_000_000,
          liquidityRisk: 'LOW' as const,
          topHolderPct: 20,
          holderCount: 250_000,
        };
      default:
        return {
          ageHours: 24,
          ageDays: 1,
          liquidity: 10_000,
          liquidityRisk: 'MEDIUM' as const,
          topHolderPct: 50,
          holderCount: 1000,
        };
    }
  }
}
