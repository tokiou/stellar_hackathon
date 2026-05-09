import type { FC } from 'react';
import { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, ShieldOff, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';
import type { RiskAssessment, RiskLevel, RiskReason } from '@/lib/types';

interface SafetyReviewPanelProps {
  assessment: RiskAssessment;
}

const SafetyReviewPanel: FC<SafetyReviewPanelProps> = ({ assessment }) => {
  const [showDetails, setShowDetails] = useState(false);
  const config = getRiskConfig(assessment.level);

  return (
    <div className={`rounded-lg border p-4 animate-fade-in-up ${config.borderClass} ${config.bgClass}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.iconBgClass} ${config.pulseClass}`}>
          {config.icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Safety Review</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-xs font-bold uppercase tracking-wider ${config.textClass}`}>
              {assessment.level}
            </span>
            <span className="text-xs text-muted-foreground">risk</span>
          </div>
        </div>
      </div>

      {/* Reasons */}
      <div className="space-y-2 mb-4">
        {assessment.reasons.map((reason, i) => {
          const reasonConfig = getRiskConfig(reason.severity);
          return (
            <div key={i} className="flex items-start gap-2.5 rounded-md bg-surface-1/50 p-2.5">
              {reason.severity === 'LOW' ? (
                <CheckCircle2 className="h-4 w-4 text-risk-low shrink-0 mt-0.5" />
              ) : reason.severity === 'BLOCKED' ? (
                <XCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${reasonConfig.textClass}`} />
              )}
              <div>
                <p className="text-xs font-semibold text-foreground">{reason.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{reason.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendation */}
      <div className="rounded-md bg-surface-2 p-3 border border-border mb-4">
        <p className="text-xs font-medium text-muted-foreground mb-1">Recommendation</p>
        <p className="text-sm text-foreground">{assessment.recommendation}</p>
      </div>

      {/* How We Checked This - Expandable */}
      <div className="border-t border-border pt-3">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center justify-between w-full text-left hover:bg-surface-1/30 rounded-md p-2 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">How We Checked This</span>
            <span className="text-xs text-muted-foreground">({assessment.reasons.length} checks)</span>
          </div>
          {showDetails ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {showDetails && (
          <div className="mt-3 space-y-3 animate-fade-in">
            {assessment.reasons.map((reason, i) => (
              <RiskSignalDetail key={i} signal={reason} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const RiskSignalDetail: FC<{ signal: RiskReason }> = ({ signal }) => {
  const config = getRiskConfig(signal.severity);
  
  return (
    <div className="rounded-md border border-border/50 bg-surface-1/30 p-3">
      {/* Check Header */}
      <div className="flex items-start gap-2 mb-2">
        <div className={`flex h-6 w-6 items-center justify-center rounded ${config.iconBgClass} shrink-0`}>
          {signal.severity === 'LOW' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-risk-low" />
          ) : signal.severity === 'BLOCKED' ? (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <AlertTriangle className={`h-3.5 w-3.5 ${config.textClass}`} />
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-foreground">{signal.checkName || signal.label}</h4>
            {signal.isMock && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                <FlaskConical className="h-2.5 w-2.5" />
                DEMO DATA
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{signal.source}</p>
        </div>
      </div>

      {/* Check Details Grid */}
      <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">Result:</span>
          <span className="ml-1 font-medium text-foreground">
            {formatValue(signal.value)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Impact:</span>
          <span className={`ml-1 font-semibold ${config.textClass}`}>
            {signal.riskImpact}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-muted-foreground">Threshold:</span>
          <span className="ml-1 text-foreground">{signal.threshold}</span>
        </div>
      </div>

      {/* Explanation */}
      {signal.explanation && (
        <div className="mt-2 pt-2 border-t border-border/30">
          <p className="text-[11px] text-muted-foreground italic">{signal.explanation}</p>
        </div>
      )}
    </div>
  );
};

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}

function getRiskConfig(level: RiskLevel) {
  switch (level) {
    case 'LOW':
      return {
        icon: <ShieldCheck className="h-5 w-5 text-risk-low" />,
        textClass: 'text-risk-low',
        borderClass: 'border-risk-low/20',
        bgClass: 'bg-risk-low/[0.03]',
        iconBgClass: 'bg-risk-low/10',
        pulseClass: 'animate-pulse-low',
      };
    case 'MEDIUM':
      return {
        icon: <ShieldAlert className="h-5 w-5 text-risk-medium" />,
        textClass: 'text-risk-medium',
        borderClass: 'border-risk-medium/20',
        bgClass: 'bg-risk-medium/[0.03]',
        iconBgClass: 'bg-risk-medium/10',
        pulseClass: 'animate-pulse-medium',
      };
    case 'HIGH':
      return {
        icon: <ShieldX className="h-5 w-5 text-risk-high" />,
        textClass: 'text-risk-high',
        borderClass: 'border-risk-high/20',
        bgClass: 'bg-risk-high/[0.03]',
        iconBgClass: 'bg-risk-high/10',
        pulseClass: 'animate-pulse-high',
      };
    case 'BLOCKED':
      return {
        icon: <ShieldOff className="h-5 w-5 text-risk-blocked" />,
        textClass: 'text-risk-blocked',
        borderClass: 'border-risk-blocked/20',
        bgClass: 'bg-risk-blocked/[0.03]',
        iconBgClass: 'bg-risk-blocked/10',
        pulseClass: '',
      };
  }
}

export default SafetyReviewPanel;