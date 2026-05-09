import { describe, it, expect } from 'vitest';
import type { RiskReason } from '../../types';
import { aggregateRiskLevel } from '../aggregation';

describe('Risk Aggregation Rules', () => {
  it('should return BLOCKED if any signal is BLOCKED', () => {
    const signals: RiskReason[] = [
      {
        label: 'Test',
        detail: 'Test',
        severity: 'LOW',
        checkName: 'test',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'LOW',
        explanation: 'test',
      },
      {
        label: 'Blocked',
        detail: 'Blocked',
        severity: 'BLOCKED',
        checkName: 'blocker',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'BLOCKED',
        explanation: 'blocked',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('BLOCKED');
  });

  it('should return HIGH if any signal is HIGH (and none BLOCKED)', () => {
    const signals: RiskReason[] = [
      {
        label: 'Low',
        detail: 'Low',
        severity: 'LOW',
        checkName: 'low',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'LOW',
        explanation: 'low',
      },
      {
        label: 'High',
        detail: 'High',
        severity: 'HIGH',
        checkName: 'high',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'HIGH',
        explanation: 'high',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('HIGH');
  });

  it('should return HIGH if two or more signals are MEDIUM', () => {
    const signals: RiskReason[] = [
      {
        label: 'Medium 1',
        detail: 'Medium 1',
        severity: 'MEDIUM',
        checkName: 'medium1',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
      {
        label: 'Medium 2',
        detail: 'Medium 2',
        severity: 'MEDIUM',
        checkName: 'medium2',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('HIGH');
  });

  it('should return MEDIUM if exactly one signal is MEDIUM', () => {
    const signals: RiskReason[] = [
      {
        label: 'Low',
        detail: 'Low',
        severity: 'LOW',
        checkName: 'low',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'LOW',
        explanation: 'low',
      },
      {
        label: 'Medium',
        detail: 'Medium',
        severity: 'MEDIUM',
        checkName: 'medium',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('MEDIUM');
  });

  it('should return LOW if all signals are LOW', () => {
    const signals: RiskReason[] = [
      {
        label: 'Low 1',
        detail: 'Low 1',
        severity: 'LOW',
        checkName: 'low1',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'LOW',
        explanation: 'low',
      },
      {
        label: 'Low 2',
        detail: 'Low 2',
        severity: 'LOW',
        checkName: 'low2',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'LOW',
        explanation: 'low',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('LOW');
  });

  it('should return LOW for empty signals array', () => {
    expect(aggregateRiskLevel([])).toBe('LOW');
  });

  it('should prioritize BLOCKED over HIGH even with multiple HIGH signals', () => {
    const signals: RiskReason[] = [
      {
        label: 'High 1',
        detail: 'High 1',
        severity: 'HIGH',
        checkName: 'high1',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'HIGH',
        explanation: 'high',
      },
      {
        label: 'Blocked',
        detail: 'Blocked',
        severity: 'BLOCKED',
        checkName: 'blocker',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'BLOCKED',
        explanation: 'blocked',
      },
      {
        label: 'High 2',
        detail: 'High 2',
        severity: 'HIGH',
        checkName: 'high2',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'HIGH',
        explanation: 'high',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('BLOCKED');
  });

  it('should handle three MEDIUM signals as HIGH', () => {
    const signals: RiskReason[] = [
      {
        label: 'Medium 1',
        detail: 'Medium 1',
        severity: 'MEDIUM',
        checkName: 'medium1',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
      {
        label: 'Medium 2',
        detail: 'Medium 2',
        severity: 'MEDIUM',
        checkName: 'medium2',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
      {
        label: 'Medium 3',
        detail: 'Medium 3',
        severity: 'MEDIUM',
        checkName: 'medium3',
        source: 'test',
        value: 'test',
        threshold: 'none',
        riskImpact: 'MEDIUM',
        explanation: 'medium',
      },
    ];
    
    expect(aggregateRiskLevel(signals)).toBe('HIGH');
  });
});
