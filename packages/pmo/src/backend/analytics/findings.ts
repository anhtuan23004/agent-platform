import type {
  PmoReportMetricId,
  PmoReportRagColor,
  PmoReportRuleSet,
  ReportRange,
} from '../reporting/rules/schema.ts';
import { dateInWeek } from './dates.ts';
import { isApprovedOtCompLeave, isTrainingLeave } from './leave-type.ts';
import {
  type ContextAnnotation,
  type ExcludedWeek,
  type Finding,
  type LeaveRow,
  type MemberWeekFact,
  PMO_ACTION_CODES,
  PMO_ACTION_TEMPLATES,
  type PmoActionCode,
  type RagColor,
  type SuggestedAction,
  type SuppressionReason,
  type Thresholds,
  type WeekRow,
} from './types.ts';

export interface FindingsContext {
  leaves: LeaveRow[];
  weeksById: Map<string, WeekRow>;
  thresholds: Thresholds;
}

/**
 * Member-level analysis derived from per-week facts. This is the Answer_Key
 * grain: one verdict per member, with the weeks that were neutralised (valid
 * edge cases) recorded explicitly so an over-log backed by approved OT or a
 * full-leave week is never mistaken for a genuine issue.
 */
export interface MemberAnalysis {
  memberId: string;
  inScopeWeekCount: number;
  busyRate: number | null;
  effortConsumption: number | null;
  excludedWeeks: ExcludedWeek[];
  annotations: ContextAnnotation[];
}

function hasApprovedOt(memberId: string, week: WeekRow, leaves: LeaveRow[]): boolean {
  return leaves.some(
    (l) =>
      l.member_id === memberId &&
      l.approved === true &&
      isApprovedOtCompLeave(l.leave_type) &&
      dateInWeek(l.leave_date, week),
  );
}

function hasTraining(memberId: string, week: WeekRow, leaves: LeaveRow[]): boolean {
  return leaves.some(
    (l) =>
      l.member_id === memberId &&
      l.approved === true &&
      isTrainingLeave(l.leave_type) &&
      dateInWeek(l.leave_date, week),
  );
}

function groupByMember(facts: MemberWeekFact[]): Map<string, MemberWeekFact[]> {
  const map = new Map<string, MemberWeekFact[]>();
  for (const fact of facts) {
    const list = map.get(fact.memberId) ?? [];
    list.push(fact);
    map.set(fact.memberId, list);
  }
  return map;
}

/** Zero-capacity weeks cannot drive utilization findings. Partial weeks stay in scope. */
function weekSuppressionReason(
  fact: MemberWeekFact,
  ctx: FindingsContext,
): SuppressionReason | null {
  const week = ctx.weeksById.get(fact.weekId);
  if (fact.availableHours > 0) return null;
  if (week && (week.holiday_hours_ft ?? 0) > 0) return 'holiday_week';
  return 'approved_leave';
}

function weekAnnotations(
  memberId: string,
  fact: MemberWeekFact,
  ctx: FindingsContext,
): ContextAnnotation[] {
  const week = ctx.weeksById.get(fact.weekId);
  if (!week) return [];
  const annotations: ContextAnnotation[] = [];
  if (hasApprovedOt(memberId, week, ctx.leaves)) {
    annotations.push({ weekId: fact.weekId, reason: 'approved_ot' });
  }
  if (hasTraining(memberId, week, ctx.leaves)) {
    annotations.push({ weekId: fact.weekId, reason: 'training' });
  }
  return annotations;
}

export function applyContextRules(
  fact: MemberWeekFact,
  ctx: FindingsContext,
): { suppressionReason: SuppressionReason | null; annotations: ContextAnnotation[] } {
  return {
    suppressionReason: weekSuppressionReason(fact, ctx),
    annotations: weekAnnotations(fact.memberId, fact, ctx),
  };
}

export function buildSuggestedActionCode(issueType: Finding['issueType']): PmoActionCode {
  if (issueType === 'overbook') return PMO_ACTION_CODES.REBALANCE_ALLOCATION;
  if (issueType === 'idle') return PMO_ACTION_CODES.REVIEW_WITH_LINE_MANAGER;
  if (issueType === 'mismatch_under') return PMO_ACTION_CODES.CHECK_MISSING_TIMESHEET;
  if (issueType === 'mismatch_over') return PMO_ACTION_CODES.REVIEW_RA_TIMESHEET_MISMATCH;
  return PMO_ACTION_CODES.NO_ACTION;
}

export function buildSuggestedActions(issueTypes: Finding['issueType'][]): PmoActionCode[] {
  return [...new Set(issueTypes.map(buildSuggestedActionCode))];
}

function makeAction(code: PmoActionCode, primary: boolean): SuggestedAction {
  return { actionCode: code, templateText: PMO_ACTION_TEMPLATES[code], primary };
}

/**
 * Build all applicable actions for a finding. The primary action is derived
 * from issueType. Annotation-driven secondary actions (CONFIRM_APPROVED_OT,
 * VALIDATE_TRAINING_TIME) are appended when the member has the corresponding
 * context annotations. Deterministic: no LLM involvement.
 */
export function buildFindingSuggestedActions(
  issueType: Finding['issueType'],
  annotations: ContextAnnotation[],
): SuggestedAction[] {
  const primaryCode = buildSuggestedActionCode(issueType);
  const actions: SuggestedAction[] = [makeAction(primaryCode, true)];

  const hasApprovedOt = annotations.some((a) => a.reason === 'approved_ot');
  const hasTraining = annotations.some((a) => a.reason === 'training');

  if (hasApprovedOt) {
    actions.push(makeAction(PMO_ACTION_CODES.CONFIRM_APPROVED_OT, false));
  }
  if (hasTraining) {
    actions.push(makeAction(PMO_ACTION_CODES.VALIDATE_TRAINING_TIME, false));
  }

  return actions;
}

export interface SupportingMetricInput {
  N02: number | null;
  N03: number | null;
  N04: number | null;
  N05: number | null;
  N06: number | null;
  N12: number | null;
  /** Weekly worked hours, used by configured absolute OT cap. */
  workedHours?: number | null;
}

export interface SupportingMetricSignal {
  metricId: Exclude<PmoReportMetricId, 'N01'>;
  value: number;
  ragColor: PmoReportRagColor;
  reviewRequired: boolean;
}

function rangeContains(value: number, range: ReportRange): boolean {
  if (range.gt !== undefined && value <= range.gt) return false;
  if (range.gte !== undefined && value < range.gte) return false;
  if (range.lt !== undefined && value >= range.lt) return false;
  if (range.lte !== undefined && value > range.lte) return false;
  return true;
}

function classifyMetricRange(
  value: number,
  bands: PmoReportRuleSet['metrics']['N02']['bands'],
): PmoReportRagColor {
  for (const color of ['red', 'yellow', 'green'] as const) {
    if (bands[color].some((range) => rangeContains(value, range))) return color;
  }
  throw new Error('report_metric_value_not_covered');
}

/** Deterministic N02-N06/N12 supporting signals from versioned rule bands. */
export function classifySupportingMetrics(
  input: SupportingMetricInput,
  rules: PmoReportRuleSet,
): SupportingMetricSignal[] {
  const metricIds = ['N02', 'N03', 'N04', 'N05', 'N06', 'N12'] as const;
  return metricIds.flatMap((metricId) => {
    const value = input[metricId];
    if (value === null) return [];
    const exceedsAbsoluteOtCap =
      metricId === 'N05' &&
      input.workedHours !== undefined &&
      input.workedHours !== null &&
      input.workedHours > rules.limits.otMaxHoursPerWeek;
    const ragColor = exceedsAbsoluteOtCap
      ? 'red'
      : classifyMetricRange(value, rules.metrics[metricId].bands);
    return [{ metricId, value, ragColor, reviewRequired: ragColor !== 'green' }];
  });
}

export function classifyPrimaryBusyRate(
  busyRate: number,
  thresholds: Thresholds,
): { issueType: 'overbook' | 'idle' | 'ok'; ragColor: RagColor } {
  if (busyRate >= thresholds.overbookRedThreshold) {
    return { issueType: 'overbook', ragColor: 'red' };
  }
  if (busyRate > thresholds.overbookThreshold) {
    return { issueType: 'overbook', ragColor: 'yellow' };
  }
  if (busyRate < thresholds.idleThreshold) {
    return { issueType: 'idle', ragColor: 'red' };
  }
  if (busyRate < thresholds.idleYellowThreshold) {
    return { issueType: 'idle', ragColor: 'yellow' };
  }
  return { issueType: 'ok', ragColor: 'green' };
}

/**
 * Aggregate per-week facts into a member-level analysis.
 *
 * Only zero-capacity weeks are excluded. Partial holiday/leave weeks retain their
 * adjusted denominator. Approved OT and training are annotations, not exclusions.
 * Member busy = Σplanned / Σavailable; EC = Σlogged / Σplanned.
 */
export function aggregateMemberFacts(
  facts: MemberWeekFact[],
  ctx: FindingsContext,
): MemberAnalysis[] {
  const byMember = groupByMember(facts);
  const analyses: MemberAnalysis[] = [];

  for (const [memberId, memberFacts] of byMember) {
    const inScope = memberFacts.filter((f) => f.scopeStatus === 'IN_SCOPE');
    const excludedWeeks: ExcludedWeek[] = [];
    const annotations: ContextAnnotation[] = [];

    let availableSum = 0;
    let loggedSum = 0;
    let plannedSum = 0;
    let anyActivity = false;

    for (const fact of inScope) {
      const context = applyContextRules(fact, ctx);
      if (context.suppressionReason) {
        excludedWeeks.push({ weekId: fact.weekId, reason: context.suppressionReason });
        continue;
      }

      annotations.push(...context.annotations);
      availableSum += fact.availableHours;
      loggedSum += fact.loggedHours;
      plannedSum += fact.plannedHours;
      if (fact.plannedHours > 0 || fact.loggedHours > 0) anyActivity = true;
    }

    // If a member has zero plan and zero log across the whole window, do not
    // classify them as "idle" at member-level. Surface this as 'no_plan' in
    // the member-week facts instead (data/planning gap).
    const busyRate = anyActivity && availableSum > 0 ? round4(plannedSum / availableSum) : null;
    const effortConsumption = anyActivity && plannedSum > 0 ? round4(loggedSum / plannedSum) : null;

    analyses.push({
      memberId,
      inScopeWeekCount: inScope.length,
      busyRate,
      effortConsumption,
      excludedWeeks,
      annotations,
    });
  }

  return analyses;
}

/** @deprecated Use aggregateMemberFacts. */
export const analyzeMembers = aggregateMemberFacts;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 100)}%`;
}

/** Genuine overbook / idle findings (member-level). */
export function detectOverbookIdle(facts: MemberWeekFact[], ctx: FindingsContext): Finding[] {
  const findings: Finding[] = [];
  for (const a of aggregateMemberFacts(facts, ctx)) {
    if (a.busyRate === null) continue;
    const classification = classifyPrimaryBusyRate(a.busyRate, ctx.thresholds);

    if (classification.issueType === 'overbook') {
      const primaryCode = buildSuggestedActionCode('overbook');
      const suggestedActions = buildFindingSuggestedActions('overbook', a.annotations);
      findings.push({
        memberId: a.memberId,
        issueType: 'overbook',
        ragColor: classification.ragColor,
        busyRate: a.busyRate,
        effortConsumption: a.effortConsumption,
        detail: `Busy ${pct(a.busyRate)} — overbooked, rebalance`,
        excludedWeeks: a.excludedWeeks,
        annotations: a.annotations,
        reviewRequired: true,
        suggestedActionCode: primaryCode,
        suggestedActions,
      });
    } else if (classification.issueType === 'idle') {
      const primaryCode = buildSuggestedActionCode('idle');
      const suggestedActions = buildFindingSuggestedActions('idle', a.annotations);
      findings.push({
        memberId: a.memberId,
        issueType: 'idle',
        ragColor: classification.ragColor,
        busyRate: a.busyRate,
        effortConsumption: a.effortConsumption,
        detail: `Busy ${pct(a.busyRate)} — under-allocated`,
        excludedWeeks: a.excludedWeeks,
        annotations: a.annotations,
        reviewRequired: true,
        suggestedActionCode: primaryCode,
        suggestedActions,
      });
    }
  }
  return findings;
}

/** Genuine logged-vs-planned mismatch findings (member-level). */
export function detectMismatch(facts: MemberWeekFact[], ctx: FindingsContext): Finding[] {
  const findings: Finding[] = [];
  for (const a of aggregateMemberFacts(facts, ctx)) {
    if (a.effortConsumption === null) continue;
    const drift = Math.abs(a.effortConsumption - 1);
    if (drift <= ctx.thresholds.mismatchPctThreshold) continue;

    const issueType = a.effortConsumption < 1 ? 'mismatch_under' : 'mismatch_over';
    const primaryCode = buildSuggestedActionCode(issueType);
    const suggestedActions = buildFindingSuggestedActions(issueType, a.annotations);
    findings.push({
      memberId: a.memberId,
      issueType,
      ragColor: 'red',
      busyRate: a.busyRate,
      effortConsumption: a.effortConsumption,
      detail:
        issueType === 'mismatch_under'
          ? `Effort consumption ${pct(a.effortConsumption)} — logged below plan`
          : `Effort consumption ${pct(a.effortConsumption)} — logged above plan`,
      excludedWeeks: a.excludedWeeks,
      annotations: a.annotations,
      reviewRequired: true,
      suggestedActionCode: primaryCode,
      suggestedActions,
    });
  }
  return findings;
}
