import { DEFAULT_THRESHOLDS, type Thresholds } from './types.ts';

export interface ConfigRow {
  overbook_threshold: number | null;
  overbook_red_threshold: number | null;
  idle_threshold: number | null;
  mismatch_pct_threshold: number | null;
  ot_max_hours_per_week: number | null;
  required_training_hours: number | null;
  effective_date: Date | null;
}

/**
 * Resolve thresholds from overbook_idle_config rows. Picks the row with the
 * latest effective_date (rows without a date sort last). Falls back to SOP
 * defaults per-field when a value is null or no rows exist.
 */
export function resolveThresholds(rows: ConfigRow[]): Thresholds {
  if (rows.length === 0) return { ...DEFAULT_THRESHOLDS };

  const latest = [...rows].sort((a, b) => {
    const ta = a.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = b.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  })[0];

  if (!latest) return { ...DEFAULT_THRESHOLDS };

  return {
    overbookThreshold: latest.overbook_threshold ?? DEFAULT_THRESHOLDS.overbookThreshold,
    overbookRedThreshold: latest.overbook_red_threshold ?? DEFAULT_THRESHOLDS.overbookRedThreshold,
    idleThreshold: latest.idle_threshold ?? DEFAULT_THRESHOLDS.idleThreshold,
    mismatchPctThreshold: latest.mismatch_pct_threshold ?? DEFAULT_THRESHOLDS.mismatchPctThreshold,
    otMaxHoursPerWeek: latest.ot_max_hours_per_week ?? DEFAULT_THRESHOLDS.otMaxHoursPerWeek,
    requiredTrainingHours: latest.required_training_hours ?? DEFAULT_THRESHOLDS.requiredTrainingHours,
  };
}
