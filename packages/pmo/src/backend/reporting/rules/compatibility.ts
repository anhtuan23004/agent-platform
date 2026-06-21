import type { PmoReportRuleSet } from './schema.ts';

export interface LegacyThresholdConfigRow {
  config_id?: string | null;
  rule_name?: string | null;
  overbook_threshold: number | null;
  overbook_red_threshold: number | null;
  idle_threshold: number | null;
  mismatch_pct_threshold: number | null;
  ot_max_hours_per_week: number | null;
  effective_date: Date | null;
}

export interface LegacyKpiNormRow {
  norm_id: string;
  formula: string | null;
}

export interface LegacyThresholdValues {
  overbookThreshold: number;
  overbookRedThreshold: number;
  idleThreshold: number;
  idleYellowThreshold: number;
  mismatchPctThreshold: number;
  otMaxHoursPerWeek: number;
}

export interface RuleCompatibilityMismatch {
  path: string;
  expected: unknown;
  actual: unknown;
}

export interface RuleCompatibilityLogger {
  warn(data: unknown, message?: string): void;
}

function requiredComparator(
  value: { gt?: number; gte?: number; lt?: number; lte?: number },
  comparator: 'gt' | 'gte' | 'lt' | 'lte',
  path: string,
): number {
  const result = value[comparator];
  if (result === undefined) throw new Error(`report_rules_missing_comparator:${path}`);
  return result;
}

export function mapReportRulesToLegacyThresholds(ruleSet: PmoReportRuleSet): LegacyThresholdValues {
  return {
    overbookThreshold: requiredComparator(
      ruleSet.classification.overbook.yellow,
      'gt',
      'classification.overbook.yellow.gt',
    ),
    overbookRedThreshold: requiredComparator(
      ruleSet.classification.overbook.red,
      'gte',
      'classification.overbook.red.gte',
    ),
    idleThreshold: requiredComparator(
      ruleSet.classification.idle.red,
      'lt',
      'classification.idle.red.lt',
    ),
    idleYellowThreshold: requiredComparator(
      ruleSet.classification.idle.yellow,
      'lt',
      'classification.idle.yellow.lt',
    ),
    mismatchPctThreshold: ruleSet.limits.mismatchPctThreshold,
    otMaxHoursPerWeek: ruleSet.limits.otMaxHoursPerWeek,
  };
}

function normalizeFormula(value: string | null): string | null {
  return value?.toLowerCase().replace(/\s+/g, '') ?? null;
}

function latestApplicableConfig(
  rows: LegacyThresholdConfigRow[],
  effectiveFrom: string,
): LegacyThresholdConfigRow | undefined {
  const effectiveAt = new Date(`${effectiveFrom}T23:59:59.999Z`).getTime();
  return [...rows]
    .filter((row) => (row.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY) <= effectiveAt)
    .sort(
      (left, right) =>
        (right.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY) -
        (left.effective_date?.getTime() ?? Number.NEGATIVE_INFINITY),
    )[0];
}

function compare(
  mismatches: RuleCompatibilityMismatch[],
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  if (actual === null || actual === undefined) return;
  if (actual !== expected) mismatches.push({ path, expected, actual });
}

export function auditLegacyRuleCompatibility(input: {
  ruleSet: PmoReportRuleSet;
  configRows: LegacyThresholdConfigRow[];
  kpiRows: LegacyKpiNormRow[];
  logger?: RuleCompatibilityLogger;
}): { mismatches: RuleCompatibilityMismatch[] } {
  const mismatches: RuleCompatibilityMismatch[] = [];
  const expected = mapReportRulesToLegacyThresholds(input.ruleSet);
  const config = latestApplicableConfig(input.configRows, input.ruleSet.effectiveFrom);

  if (config) {
    compare(
      mismatches,
      'classification.overbook.yellow.gt',
      expected.overbookThreshold,
      config.overbook_threshold,
    );
    compare(
      mismatches,
      'classification.overbook.red.gte',
      expected.overbookRedThreshold,
      config.overbook_red_threshold,
    );
    compare(
      mismatches,
      'classification.idle.red.lt',
      expected.idleThreshold,
      config.idle_threshold,
    );
    compare(
      mismatches,
      'limits.mismatchPctThreshold',
      expected.mismatchPctThreshold,
      config.mismatch_pct_threshold,
    );
    compare(
      mismatches,
      'limits.otMaxHoursPerWeek',
      expected.otMaxHoursPerWeek,
      config.ot_max_hours_per_week,
    );
  }

  for (const row of input.kpiRows) {
    const metricId = row.norm_id as keyof PmoReportRuleSet['metrics'];
    const metric = input.ruleSet.metrics[metricId];
    if (!metric || row.formula === null) continue;
    compare(
      mismatches,
      `metrics.${row.norm_id}.formula`,
      normalizeFormula(metric.formula),
      normalizeFormula(row.formula),
    );
  }

  if (mismatches.length > 0) {
    input.logger?.warn(
      {
        ruleSetId: input.ruleSet.ruleSetId,
        ruleVersion: input.ruleSet.version,
        mismatches,
      },
      'PMO legacy threshold configuration differs from versioned report rules',
    );
  }

  return { mismatches };
}
