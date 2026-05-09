import type {
  ParsedIntent,
  RiskAssessment,
  RiskLevel,
  RiskReason,
  SwapQuote,
  RiskProviderInput,
  RiskProviderResult,
} from './types';
import { aggregateRiskLevel } from './risk/aggregation';
import { LocalAllowlistProvider } from './risk/providers/LocalAllowlistProvider';
import { RecipientValidationProvider } from './risk/providers/RecipientValidationProvider';
import { JupiterQuoteRiskProvider } from './risk/providers/JupiterQuoteRiskProvider';
import { BirdeyeTokenSecurityProvider } from './risk/providers/BirdeyeTokenSecurityProvider';
import { ExternalRiskScoreProvider } from './risk/providers/ExternalRiskScoreProvider';
import { TransactionSimulationProvider } from './risk/providers/TransactionSimulationProvider';

const HIGH_RISK_CONFIRMATION_PHRASE = 'I understand the risk and want to continue';

/**
 * Provider-based deterministic risk engine.
 * Orchestrates multiple risk providers and aggregates their signals.
 */
export async function assessRisk(
  intent: ParsedIntent,
  quote?: SwapQuote,
  preparedTransaction?: unknown,
  connection?: unknown,
  userPublicKey?: string,
): Promise<RiskAssessment> {
  // Early exit for low confidence
  if (intent.confidence === 'low') {
    const parserSignal: RiskReason = {
      label: 'Low parser confidence',
      detail: 'The intent could not be parsed with sufficient confidence. Please rephrase.',
      severity: 'BLOCKED',
      checkName: 'parser_confidence',
      source: 'Intent Parser',
      value: intent.confidence,
      threshold: 'Must be medium or high',
      riskImpact: 'BLOCKED',
      explanation: 'The system could not understand your request clearly enough to assess it safely.',
    };

    return {
      level: 'BLOCKED',
      reasons: [parserSignal],
      signals: [parserSignal],
      recommendation: 'Rephrase your intent more clearly.',
      requiresConfirmation: false,
      providerResults: [],
    };
  }

  // Initialize providers
  const providers = [
    new LocalAllowlistProvider(),
    new RecipientValidationProvider(),
    new JupiterQuoteRiskProvider(),
    new BirdeyeTokenSecurityProvider(),
    new ExternalRiskScoreProvider(),
    new TransactionSimulationProvider(),
  ];

  // Prepare input
  const input: RiskProviderInput = {
    intent,
    quote,
    preparedTransaction,
    connection,
    userPublicKey,
  };

  // Run all providers in parallel
  const providerResults: RiskProviderResult[] = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await provider.assess(input);
      } catch (error) {
        // Provider errors should not crash the assessment
        return {
          provider: provider.name,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    })
  );

  // Collect all signals from successful providers
  const allSignals: RiskReason[] = [];
  for (const result of providerResults) {
    if (result.signals && result.signals.length > 0) {
      allSignals.push(...result.signals);
    }
  }

  // Ensure backward compatibility with old RiskReason format
  const compatibleSignals = allSignals.map(signal => ({
    ...signal,
    // Ensure required old fields exist
    label: signal.label,
    detail: signal.detail,
    severity: signal.severity,
  }));

  // Aggregate risk level
  const level = aggregateRiskLevel(compatibleSignals);

  // Build final assessment
  const assessment: RiskAssessment = {
    level,
    reasons: compatibleSignals,
    signals: compatibleSignals, // Alias for backward compatibility
    recommendation: getRecommendation(level),
    requiresConfirmation: level === 'HIGH' || level === 'BLOCKED',
    confirmationPhrase: level === 'HIGH' ? HIGH_RISK_CONFIRMATION_PHRASE : undefined,
    providerResults,
  };

  return assessment;
}

function getRecommendation(level: RiskLevel): string {
  switch (level) {
    case 'LOW':
      return 'This transaction appears safe. Review the details before signing.';
    case 'MEDIUM':
      return 'Elevated risk detected. Review all details carefully before proceeding.';
    case 'HIGH':
      return 'High risk detected. You must type the confirmation phrase to proceed. Only continue if you fully understand the risks.';
    case 'BLOCKED':
      return 'This transaction is blocked for safety. It cannot be prepared.';
  }
}

export { HIGH_RISK_CONFIRMATION_PHRASE };