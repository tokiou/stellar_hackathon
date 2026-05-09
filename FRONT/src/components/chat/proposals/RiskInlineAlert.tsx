import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { RiskInfo } from '@/types/api';
import { useSettingsStore } from '@/stores/settingsStore';

export function RiskInlineAlert({ risk }: { risk: RiskInfo }) {
  const enabled = useSettingsStore((state) => state.riskWarningsEnabled);
  if (!enabled) return null;
  if (risk.level === 'low') {
    return (
      <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold text-success">
        <ShieldCheck className="h-3.5 w-3.5" /> Low risk · {risk.score}/100
      </div>
    );
  }

  const critical = risk.level === 'critical';
  return (
    <div className={`mt-4 rounded-2xl border p-4 ${critical ? 'border-error-border bg-error-bg text-error-text' : 'border-warning-border bg-warning-bg text-warning-text'}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" />
        <div>
          <p className="text-sm font-semibold">{critical ? 'Critical risk' : 'Risk warning'} · {risk.score}/100</p>
          {risk.reasons?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
              {risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
