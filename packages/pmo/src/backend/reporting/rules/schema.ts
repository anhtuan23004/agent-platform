import { z } from 'zod';

export const PMO_REPORT_METRIC_IDS = ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N12'] as const;
export type PmoReportMetricId = (typeof PMO_REPORT_METRIC_IDS)[number];
export type PmoReportRagColor = 'green' | 'yellow' | 'red';

export const REPORT_METRIC_FORMULAS = {
  N02: 'worked_h / available_h',
  N03: 'billable_h / worked_h',
  N04: 'bench_h / available_h',
  N05: 'ot_h / standard_h',
  N06: 'actual_h / planned_h',
  N12: 'done / required',
} as const;

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), {
    message: 'invalid ISO date',
  });

export const ReportRangeSchema = z
  .object({
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.gt === undefined &&
      value.gte === undefined &&
      value.lt === undefined &&
      value.lte === undefined
    ) {
      ctx.addIssue({ code: 'custom', message: 'range requires at least one comparator' });
    }
    if (value.gt !== undefined && value.gte !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'range cannot contain both gt and gte' });
    }
    if (value.lt !== undefined && value.lte !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'range cannot contain both lt and lte' });
    }
  });

export type ReportRange = z.infer<typeof ReportRangeSchema>;

const MetricRuleSchema = z.object({
  formula: z.string().min(1),
  bands: z.object({
    green: z.array(ReportRangeSchema).min(1),
    yellow: z.array(ReportRangeSchema).min(1),
    red: z.array(ReportRangeSchema).min(1),
  }),
});

export const PmoReportRuleSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    ruleSetId: z.string().min(1),
    version: z.string().min(1),
    effectiveFrom: IsoDateSchema,
    classification: z.object({
      primaryMetric: z.literal('N01'),
      idle: z.object({
        red: ReportRangeSchema,
        yellow: ReportRangeSchema,
      }),
      healthy: ReportRangeSchema,
      overbook: z.object({
        yellow: ReportRangeSchema,
        red: ReportRangeSchema,
      }),
    }),
    metrics: z.object({
      N02: MetricRuleSchema,
      N03: MetricRuleSchema,
      N04: MetricRuleSchema,
      N05: MetricRuleSchema,
      N06: MetricRuleSchema,
      N12: MetricRuleSchema,
    }),
    limits: z.object({
      mismatchPctThreshold: z.number().finite().nonnegative(),
      otMaxHoursPerWeek: z.number().finite().positive(),
    }),
    recommendation: z.object({
      enabled: z.boolean(),
      candidateCount: z.object({
        default: z.number().int().positive(),
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      }),
      historyWindowDays: z.number().int().positive(),
      transferStepHours: z.number().finite().positive(),
      minimumSkillCoverage: z.number().finite().min(0).max(1),
      idealTargetBusyRate: z.number().finite().nonnegative(),
      capacityFitTolerance: z.number().finite().positive(),
      maxScenariosPerSource: z.number().int().positive(),
      taskHistoryTopK: z.number().int().positive(),
      scoring: z.object({
        skillCoverage: z.number().finite().min(0).max(1),
        taskHistorySimilarity: z.number().finite().min(0).max(1),
        capacityFit: z.number().finite().min(0).max(1),
        projectContext: z.number().finite().min(0).max(1),
      }),
      confidence: z.object({
        high: ReportRangeSchema,
        medium: ReportRangeSchema,
        low: ReportRangeSchema,
      }),
      adjacentSkills: z.record(z.string().min(1), z.array(z.string().min(1))),
    }),
    reportLimits: z.object({
      maxWeeks: z.number().int().positive(),
      maxMembersForPdf: z.number().int().positive(),
      maxFindingsForPdf: z.number().int().positive(),
    }),
  })
  .strict();

export type PmoReportRuleSet = z.infer<typeof PmoReportRuleSetSchema>;

interface NormalizedInterval {
  lower: number;
  lowerInclusive: boolean;
  upper: number;
  upperInclusive: boolean;
}

function normalizeInterval(range: ReportRange, path: string, issues: string[]): NormalizedInterval {
  const lower = range.gte ?? range.gt ?? Number.NEGATIVE_INFINITY;
  const upper = range.lte ?? range.lt ?? Number.POSITIVE_INFINITY;
  const lowerInclusive = range.gte !== undefined;
  const upperInclusive = range.lte !== undefined;

  if (lower > upper || (lower === upper && !(lowerInclusive && upperInclusive))) {
    issues.push(`${path}: empty or inverted interval`);
  }

  return { lower, lowerInclusive, upper, upperInclusive };
}

function displayBoundary(value: number): string {
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  return String(value);
}

function validateCoverage(ranges: ReportRange[], path: string, issues: string[]): void {
  const intervals = ranges
    .map((range, index) => normalizeInterval(range, `${path}.${index}`, issues))
    .sort(
      (left, right) =>
        left.lower - right.lower || Number(right.lowerInclusive) - Number(left.lowerInclusive),
    );

  const first = intervals[0];
  const last = intervals.at(-1);
  if (!first || !last) return;

  if (first.lower !== Number.NEGATIVE_INFINITY) {
    issues.push(`${path}: uncovered values below ${displayBoundary(first.lower)}`);
  }

  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (!previous || !current) continue;

    if (previous.upper > current.lower) {
      issues.push(`${path}: overlapping intervals at ${displayBoundary(current.lower)}`);
      continue;
    }
    if (previous.upper < current.lower) {
      issues.push(
        `${path}: gap between ${displayBoundary(previous.upper)} and ${displayBoundary(current.lower)}`,
      );
      continue;
    }
    if (previous.upperInclusive && current.lowerInclusive) {
      issues.push(`${path}: overlapping intervals at ${displayBoundary(current.lower)}`);
    } else if (!previous.upperInclusive && !current.lowerInclusive) {
      issues.push(`${path}: gap at ${displayBoundary(current.lower)}`);
    }
  }

  if (last.upper !== Number.POSITIVE_INFINITY) {
    issues.push(`${path}: uncovered values above ${displayBoundary(last.upper)}`);
  }
}

function formatSchemaIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.') || '<root>';
    return `${path}: ${issue.message}`;
  });
}

function normalizeFormula(formula: string): string {
  return formula.toLowerCase().replace(/\s+/g, '');
}

export function validateRuleSet(input: unknown): PmoReportRuleSet {
  const parsed = PmoReportRuleSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `PMO report rule validation failed:\n${formatSchemaIssues(parsed.error).join('\n')}`,
    );
  }

  const rules = parsed.data;
  const issues: string[] = [];
  const classificationRanges = [
    rules.classification.idle.red,
    rules.classification.idle.yellow,
    rules.classification.healthy,
    rules.classification.overbook.yellow,
    rules.classification.overbook.red,
  ];
  validateCoverage(classificationRanges, 'classification', issues);

  for (const metricId of ['N02', 'N03', 'N04', 'N05', 'N06', 'N12'] as const) {
    const metric = rules.metrics[metricId];
    const expectedFormula = REPORT_METRIC_FORMULAS[metricId];
    if (normalizeFormula(metric.formula) !== normalizeFormula(expectedFormula)) {
      issues.push(`metrics.${metricId}.formula: expected "${expectedFormula}"`);
    }
    validateCoverage(
      [...metric.bands.red, ...metric.bands.yellow, ...metric.bands.green],
      `metrics.${metricId}.bands`,
      issues,
    );
  }

  const { min, default: defaultCount, max } = rules.recommendation.candidateCount;
  if (min > max) issues.push('recommendation.candidateCount.min: must be <= max');
  if (defaultCount < min || defaultCount > max) {
    issues.push('recommendation.candidateCount.default: must be between min and max');
  }

  const scoringTotal = Object.values(rules.recommendation.scoring).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (Math.abs(scoringTotal - 1) > 1e-9) {
    issues.push('recommendation.scoring: weights must sum to 1');
  }

  const { high, medium, low } = rules.recommendation.confidence;
  const highFloor = high.gte ?? high.gt;
  const mediumFloor = medium.gte ?? medium.gt;
  const lowFloor = low.gte ?? low.gt;
  if (
    highFloor === undefined ||
    mediumFloor === undefined ||
    lowFloor === undefined ||
    !(highFloor > mediumFloor && mediumFloor > lowFloor)
  ) {
    issues.push('recommendation.confidence: expected descending high, medium, and low floors');
  }

  for (const [skill, adjacent] of Object.entries(rules.recommendation.adjacentSkills)) {
    if (adjacent.some((candidate) => candidate === skill)) {
      issues.push(`recommendation.adjacentSkills.${skill}: cannot reference itself`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`PMO report rule validation failed:\n${issues.join('\n')}`);
  }

  return rules;
}

function rangeIncludes(range: ReportRange, value: number): boolean {
  if (range.gt !== undefined && !(value > range.gt)) return false;
  if (range.gte !== undefined && !(value >= range.gte)) return false;
  if (range.lt !== undefined && !(value < range.lt)) return false;
  if (range.lte !== undefined && !(value <= range.lte)) return false;
  return true;
}

export function classifyReportMetric(
  rules: PmoReportRuleSet,
  metricId: PmoReportMetricId,
  value: number,
): PmoReportRagColor | null {
  if (!Number.isFinite(value)) return null;

  if (metricId === 'N01') {
    const entries: Array<[PmoReportRagColor, ReportRange]> = [
      ['red', rules.classification.idle.red],
      ['red', rules.classification.overbook.red],
      ['yellow', rules.classification.idle.yellow],
      ['yellow', rules.classification.overbook.yellow],
      ['green', rules.classification.healthy],
    ];
    return entries.find(([, range]) => rangeIncludes(range, value))?.[0] ?? null;
  }

  const metric = rules.metrics[metricId];
  for (const color of ['red', 'yellow', 'green'] as const) {
    if (metric.bands[color].some((range) => rangeIncludes(range, value))) return color;
  }
  return null;
}
