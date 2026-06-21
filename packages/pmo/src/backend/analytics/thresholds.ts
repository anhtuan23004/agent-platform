import { DEFAULT_THRESHOLDS, type Thresholds } from './types.ts';

export interface ConfigRow {
  config_id?: string | null;
  rule_name?: string | null;
  overbook_threshold: number | null;
  overbook_red_threshold: number | null;
  idle_threshold: number | null;
  mismatch_pct_threshold: number | null;
  ot_max_hours_per_week: number | null;
  required_training_hours: number | null;
  effective_date: Date | null;
}

export interface ThresholdResolutionOptions {
  effectiveDate?: Date;
}

/**
 * Pick the config active on the requested effective date. Without a requested
 * date, use the latest config. Rows without effective_date act as a baseline.
 */
export function selectThresholdConfig(
  rows: ConfigRow[],
  options: ThresholdResolutionOptions = {},
): ConfigRow | undefined {
  if (rows.length === 0) return undefined;
  const effectiveDate = options.effectiveDate;

  const applicable = effectiveDate
    ? rows.filter((row) => {
        const effectiveTime = row.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY;
        return effectiveTime <= effectiveDate.getTime();
      })
    : rows;

  const latest = [...applicable].sort((a, b) => {
    const ta = a.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = b.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  })[0];

  return latest;
}

/**
 * Resolve thresholds from overbook_idle_config rows. Falls back to SOP defaults
 * per-field when a value is null or no config applies to the selected date.
 */
export function resolveThresholds(
  rows: ConfigRow[],
  options: ThresholdResolutionOptions = {},
): Thresholds {
  const latest = selectThresholdConfig(rows, options);

  if (!latest) return { ...DEFAULT_THRESHOLDS };

  return {
    overbookThreshold: latest.overbook_threshold ?? DEFAULT_THRESHOLDS.overbookThreshold,
    overbookRedThreshold: latest.overbook_red_threshold ?? DEFAULT_THRESHOLDS.overbookRedThreshold,
    idleThreshold: latest.idle_threshold ?? DEFAULT_THRESHOLDS.idleThreshold,
    idleYellowThreshold: DEFAULT_THRESHOLDS.idleYellowThreshold,
    mismatchPctThreshold: latest.mismatch_pct_threshold ?? DEFAULT_THRESHOLDS.mismatchPctThreshold,
    otMaxHoursPerWeek: latest.ot_max_hours_per_week ?? DEFAULT_THRESHOLDS.otMaxHoursPerWeek,
    requiredTrainingHours:
      latest.required_training_hours ?? DEFAULT_THRESHOLDS.requiredTrainingHours,
  };
}
