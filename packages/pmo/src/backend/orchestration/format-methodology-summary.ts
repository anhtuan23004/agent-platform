export interface MethodologyPayload {
  topic: string;
  formulas: Record<string, string>;
  thresholds: {
    overbookWarningAbove: number;
    overbookRedAtOrAbove: number;
    idleRedBelow: number;
    idleWarningBelow: number;
    mismatchPctThreshold: number;
    otMaxHoursPerWeek: number;
  };
  exclusions: string[];
  notes: string[];
  ruleSet?: {
    ruleSetId: string;
    version: string;
    effectiveFrom: string;
  };
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** Plain-text methodology block for chat — no LaTeX. */
export function formatMethodologySummary(payload: MethodologyPayload): string {
  const lines: string[] = ['PMO utilization methodology (from rule catalog):', ''];

  if (Object.keys(payload.formulas).length > 0) {
    lines.push('Formulas:');
    for (const [key, formula] of Object.entries(payload.formulas)) {
      lines.push(`- ${key}: ${formula}`);
    }
    lines.push('');
  }

  lines.push('Thresholds:');
  lines.push(`- Overbook warning: above ${pct(payload.thresholds.overbookWarningAbove)}`);
  lines.push(`- Overbook red: at or above ${pct(payload.thresholds.overbookRedAtOrAbove)}`);
  lines.push(`- Idle red: below ${pct(payload.thresholds.idleRedBelow)}`);
  lines.push(`- Idle warning: below ${pct(payload.thresholds.idleWarningBelow)}`);
  lines.push(`- Mismatch: above ${pct(payload.thresholds.mismatchPctThreshold)} deviation`);
  lines.push(`- OT cap: ${payload.thresholds.otMaxHoursPerWeek}h per week`);
  lines.push('');

  if (payload.exclusions.length > 0) {
    lines.push('Exclusions:');
    for (const rule of payload.exclusions) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (payload.notes.length > 0) {
    lines.push('Notes:');
    for (const note of payload.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  if (payload.ruleSet) {
    lines.push(
      `Rule set: ${payload.ruleSet.ruleSetId} v${payload.ruleSet.version} (effective ${payload.ruleSet.effectiveFrom})`,
    );
  }

  return lines.join('\n').trimEnd();
}
