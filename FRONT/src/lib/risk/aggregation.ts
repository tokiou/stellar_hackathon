import type { RiskLevel, RiskReason } from '../types';

/**
 * Aggregate risk signals into a final risk level using deterministic rules.
 * 
 * Rules:
 * 1. If any signal is BLOCKED, final risk = BLOCKED.
 * 2. Else if any signal is HIGH, final risk = HIGH.
 * 3. Else if two or more signals are MEDIUM, final risk = HIGH.
 * 4. Else if one signal is MEDIUM, final risk = MEDIUM.
 * 5. Else final risk = LOW.
 * 
 * @param signals Array of risk signals from providers
 * @returns Final aggregated risk level
 */
export function aggregateRiskLevel(signals: RiskReason[]): RiskLevel {
  if (signals.length === 0) {
    return 'LOW';
  }

  // Rule 1: Any BLOCKED => BLOCKED
  if (signals.some(s => s.severity === 'BLOCKED')) {
    return 'BLOCKED';
  }

  // Rule 2: Any HIGH => HIGH
  if (signals.some(s => s.severity === 'HIGH')) {
    return 'HIGH';
  }

  // Rule 3: Two or more MEDIUM => HIGH
  const mediumCount = signals.filter(s => s.severity === 'MEDIUM').length;
  if (mediumCount >= 2) {
    return 'HIGH';
  }

  // Rule 4: One MEDIUM => MEDIUM
  if (mediumCount === 1) {
    return 'MEDIUM';
  }

  // Rule 5: Else LOW
  return 'LOW';
}
