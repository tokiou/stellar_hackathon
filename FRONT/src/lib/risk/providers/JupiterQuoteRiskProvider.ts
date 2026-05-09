import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
  SwapQuote,
  AllowedToken,
} from '../../types';
import { TOKEN_REGISTRY } from '../../tokens';

// Jupiter Quote API response types
type JupiterSwapInfo = {
  ammKey: string;
  label?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
};

type JupiterRoutePlan = {
  swapInfo: JupiterSwapInfo;
};

type JupiterQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct: number | string;
  slippageBps: number;
  otherAmountThreshold: string;
  routePlan: JupiterRoutePlan[];
};

/**
 * Jupiter quote risk provider - analyzes swap quotes for risk factors.
 * 
 * When configured, calls the real Jupiter Quote API using token mints and amounts from TOKEN_REGISTRY.
 * Falls back to analyzing the demo quote if API is unavailable or fetch fails, ensuring the app works
 * without API configuration.
 * 
 * Rules:
 * - No route found: BLOCKED
 * - Invalid/zero output: BLOCKED
 * - Price impact > 10%: HIGH
 * - Price impact > 3%: MEDIUM
 * - Slippage > 5%: HIGH
 * - Slippage > 2%: MEDIUM
 */
export class JupiterQuoteRiskProvider implements RiskProvider {
  readonly name = 'JupiterQuoteRisk';
  readonly source = 'Jupiter Quote Analysis';
  private readonly apiUrl: string;

  constructor() {
    // Route through BACK by default. If VITE_BACKEND_URL is unset, Vite proxies /api to BACK in dev.
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
    this.apiUrl = `${backendUrl.replace(/\/$/, '')}/api/jupiter`;
  }

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    try {
      // Only assess swap intents
      if (input.intent.action !== 'swap') {
        return {
          provider: this.name,
          status: 'success',
          signals: [],
        };
      }

      // Try to fetch real quote from Jupiter API
      let quote: SwapQuote | null = null;
      try {
        quote = await this.fetchJupiterQuote(
          input.intent.inputToken,
          input.intent.outputToken,
          input.intent.amount,
          input.intent.slippage
        );
      } catch {
        // API fetch failed - fall back to the app's local demo quote if provided.
        // This keeps the MVP usable without network/API availability while the UI labels
        // other unavailable paid-provider data as DEMO DATA via mock providers.
        quote = input.quote || null;
      }

      // If no quote available at all, block
      if (!quote) {
        signals.push({
          label: 'No Quote Available',
          detail: 'Swap quote is not available yet.',
          severity: 'BLOCKED',
          checkName: 'quote_availability',
          source: this.source,
          value: null,
          threshold: 'Quote must be available',
          riskImpact: 'BLOCKED',
          explanation: 'A valid quote is required to assess swap risk.',
        });
        
        return {
          provider: this.name,
          status: 'success',
          signals,
        };
      }

      // Check for valid route
      if (!quote.route || quote.route === '' || quote.estimatedOutput === 0) {
        signals.push({
          label: 'No Route Found',
          detail: 'Jupiter could not find a valid swap route for this trade.',
          severity: 'BLOCKED',
          checkName: 'route_availability',
          source: this.source,
          value: false,
          threshold: 'Must have valid route',
          riskImpact: 'BLOCKED',
          explanation: 'This swap cannot be executed because no liquidity route exists.',
        });
        
        return {
          provider: this.name,
          status: 'success',
          signals,
        };
      }

      // Check price impact
      if (quote.priceImpact > 10) {
        signals.push({
          label: 'Severe Price Impact',
          detail: `Price impact is ${quote.priceImpact.toFixed(2)}%, which is extremely high.`,
          severity: 'HIGH',
          checkName: 'price_impact',
          source: this.source,
          value: quote.priceImpact,
          threshold: '> 10% = HIGH, > 3% = MEDIUM',
          riskImpact: 'HIGH',
          explanation: 'High price impact means you will receive significantly less than the market price. This usually indicates low liquidity.',
        });
      } else if (quote.priceImpact > 3) {
        signals.push({
          label: 'Elevated Price Impact',
          detail: `Price impact is ${quote.priceImpact.toFixed(2)}%, which is above normal.`,
          severity: 'MEDIUM',
          checkName: 'price_impact',
          source: this.source,
          value: quote.priceImpact,
          threshold: '> 10% = HIGH, > 3% = MEDIUM',
          riskImpact: 'MEDIUM',
          explanation: 'Moderate price impact means you will receive somewhat less than the market price.',
        });
      } else {
        signals.push({
          label: 'Normal Price Impact',
          detail: `Price impact is ${quote.priceImpact.toFixed(2)}%, which is acceptable.`,
          severity: 'LOW',
          checkName: 'price_impact',
          source: this.source,
          value: quote.priceImpact,
          threshold: '<= 3%',
          riskImpact: 'LOW',
          explanation: 'Price impact is within normal range.',
        });
      }

      // Check slippage tolerance
      const slippage = input.intent.slippage || quote.slippage;
      if (slippage > 5) {
        signals.push({
          label: 'High Slippage Tolerance',
          detail: `Slippage tolerance is ${slippage}%, which is very high.`,
          severity: 'HIGH',
          checkName: 'slippage_tolerance',
          source: this.source,
          value: slippage,
          threshold: '> 5% = HIGH, > 2% = MEDIUM',
          riskImpact: 'HIGH',
          explanation: 'High slippage tolerance means you may receive much less than expected. This is risky especially for volatile tokens.',
        });
      } else if (slippage > 2) {
        signals.push({
          label: 'Elevated Slippage Tolerance',
          detail: `Slippage tolerance is ${slippage}%, which is above normal.`,
          severity: 'MEDIUM',
          checkName: 'slippage_tolerance',
          source: this.source,
          value: slippage,
          threshold: '> 5% = HIGH, > 2% = MEDIUM',
          riskImpact: 'MEDIUM',
          explanation: 'Moderate slippage tolerance. Consider lowering if the token has good liquidity.',
        });
      }

      // Check route quality
      if (quote.route && quote.route !== 'Direct') {
        signals.push({
          label: 'Multi-Hop Route',
          detail: `This swap uses a multi-hop route: ${quote.route}`,
          severity: 'LOW',
          checkName: 'route_complexity',
          source: this.source,
          value: quote.route,
          threshold: 'N/A',
          riskImpact: 'LOW',
          explanation: 'Multi-hop routes can have slightly higher slippage and fees.',
          metadata: { route: quote.route },
        });
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

  /**
   * Fetch a real quote from Jupiter Quote API.
   * Uses TOKEN_REGISTRY to get mints and decimals, converts amounts to raw units.
   * Parses priceImpactPct, routePlan, outAmount, otherAmountThreshold from response.
   */
  private async fetchJupiterQuote(
    inputToken: AllowedToken,
    outputToken: AllowedToken,
    amount: number,
    slippagePercent: number
  ): Promise<SwapQuote> {
    const inputInfo = TOKEN_REGISTRY[inputToken];
    const outputInfo = TOKEN_REGISTRY[outputToken];

    // Convert amount to raw units (multiply by 10^decimals)
    const rawAmount = Math.floor(amount * Math.pow(10, inputInfo.decimals));

    // Build Jupiter Quote API URL
    const params = new URLSearchParams({
      inputMint: inputInfo.mint,
      outputMint: outputInfo.mint,
      amount: rawAmount.toString(),
      slippageBps: Math.floor(slippagePercent * 100).toString(), // Convert percent to basis points
    });

    const url = `${this.apiUrl}/quote?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}`);
    }

    const data = await response.json() as JupiterQuoteResponse;

    // Parse route from routePlan. Empty routePlan means no executable route.
    let route = '';
    if (data.routePlan && data.routePlan.length > 1) {
      route = data.routePlan.map(r => r.swapInfo.label || 'Unknown').join(' → ');
    } else if (data.routePlan && data.routePlan.length === 1) {
      route = data.routePlan[0].swapInfo.label || 'Direct';
    }

    // Convert raw output to decimal units
    const estimatedOutput = Number.parseInt(data.outAmount, 10) / Math.pow(10, outputInfo.decimals);
    const exchangeRate = estimatedOutput / amount;

    // Convert slippage from bps to percentage
    const slippage = data.slippageBps / 100;
    const priceImpact = typeof data.priceImpactPct === 'string'
      ? Number.parseFloat(data.priceImpactPct)
      : data.priceImpactPct;

    return {
      inputToken,
      outputToken,
      inputAmount: amount,
      estimatedOutput,
      priceImpact: Number.isFinite(priceImpact) ? priceImpact : 0,
      slippage,
      route,
      provider: 'jupiter',
      networkFeeEstimate: 0.000005, // Estimate
      exchangeRate,
    };
  }
}
