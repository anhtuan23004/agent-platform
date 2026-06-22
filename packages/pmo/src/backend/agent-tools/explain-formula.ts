import { defineAgentTool } from '@seta/agent-sdk';
import { z } from 'zod';
import { resolveReportRules } from '../reporting/rules/resolve.ts';
import { REPORT_METRIC_FORMULAS } from '../reporting/rules/schema.ts';
import { tenantIdFromContext } from './context.ts';

const formulaTopicSchema = z.enum([
  'busy_rate',
  'utilization',
  'billable_rate',
  'bench_rate',
  'overtime_ratio',
  'effort_consumption',
  'training_compliance',
  'thresholds',
  'exclusions',
  'all',
]);

function dateOrToday(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('invalid_effective_date');
  return parsed;
}

export const pmoExplainFormulaTool = defineAgentTool({
  id: 'pmo_explainFormula',
  name: 'Explain PMO Formula',
  description:
    'Explain PMO formulas, thresholds, exclusion rules, and rule-set version from deterministic code/rule catalog. Use for methodology questions like "busy rate formula", "idle threshold", or "why exclude W3".',
  input: z.object({
    topic: formulaTopicSchema.default('all'),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  output: z.object({
    topic: formulaTopicSchema,
    ruleSet: z.object({
      ruleSetId: z.string(),
      version: z.string(),
      effectiveFrom: z.string(),
      sha256: z.string(),
    }),
    formulas: z.record(z.string(), z.string()),
    thresholds: z.object({
      overbookWarningAbove: z.number(),
      overbookRedAtOrAbove: z.number(),
      idleRedBelow: z.number(),
      idleWarningBelow: z.number(),
      mismatchPctThreshold: z.number(),
      otMaxHoursPerWeek: z.number(),
    }),
    exclusions: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  rbac: 'pmo.data.read',
  execute: async (input, ctx) => {
    const rules = await resolveReportRules({
      tenantId: tenantIdFromContext(ctx),
      effectiveAt: dateOrToday(input.effectiveDate),
    });
    const allFormulas = {
      N01: 'busyRate = plannedHours / availableHours',
      N02: REPORT_METRIC_FORMULAS.N02,
      N03: REPORT_METRIC_FORMULAS.N03,
      N04: REPORT_METRIC_FORMULAS.N04,
      N05: REPORT_METRIC_FORMULAS.N05,
      N06: REPORT_METRIC_FORMULAS.N06,
      N12: REPORT_METRIC_FORMULAS.N12,
      memberBusyRate: 'sum(plannedHours) / sum(availableHours), excluding zero-capacity weeks',
      memberEffortConsumption:
        'sum(loggedHours) / sum(plannedHours), excluding zero-capacity weeks',
    };
    const topicFormulaKeys: Record<z.infer<typeof formulaTopicSchema>, string[]> = {
      busy_rate: ['N01', 'memberBusyRate'],
      utilization: ['N02'],
      billable_rate: ['N03'],
      bench_rate: ['N04'],
      overtime_ratio: ['N05'],
      effort_consumption: ['N06', 'memberEffortConsumption'],
      training_compliance: ['N12'],
      thresholds: [],
      exclusions: [],
      all: Object.keys(allFormulas),
    };
    const keys = topicFormulaKeys[input.topic];
    const formulas =
      input.topic === 'all'
        ? allFormulas
        : Object.fromEntries(
            keys.map((key) => [key, allFormulas[key as keyof typeof allFormulas]]),
          );

    return {
      topic: input.topic,
      ruleSet: {
        ruleSetId: rules.ruleSetId,
        version: rules.version,
        effectiveFrom: rules.effectiveFrom,
        sha256: rules.sha256,
      },
      formulas,
      thresholds: {
        overbookWarningAbove: rules.classification.overbook.yellow.gt ?? 1,
        overbookRedAtOrAbove: rules.classification.overbook.red.gte ?? 1.2,
        idleRedBelow: rules.classification.idle.red.lt ?? 0.5,
        idleWarningBelow: rules.classification.idle.yellow.lt ?? 0.8,
        mismatchPctThreshold: rules.limits.mismatchPctThreshold,
        otMaxHoursPerWeek: rules.limits.otMaxHoursPerWeek,
      },
      exclusions: [
        'PRE_HIRE member-weeks do not drive findings.',
        'Zero-capacity weeks are excluded from member-level busy/effort aggregation.',
        'Full holiday weeks become zero-capacity holiday_week exclusions.',
        'Full approved leave weeks become zero-capacity approved_leave exclusions.',
        'Approved OT and training are annotations, not exclusions, unless capacity becomes zero.',
      ],
      notes: [
        'Available hours account for working days, member std hours/week, holidays, approved absence.',
        'Detect tools return excludedWeeks per finding when rules neutralise weeks.',
      ],
    };
  },
});
