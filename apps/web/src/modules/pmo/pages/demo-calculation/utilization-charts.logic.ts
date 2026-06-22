import type { CategoricalBarRow, ChartReferenceLine, DonutSlice } from '@seta/shared-ui';
import type {
  DemoAnalyticsResult,
  DemoMemberAnalysisRow,
  DemoThresholds,
} from '../../api/demo-analytics.ts';

export type UtilizationWorkloadView = 'member' | 'project' | 'week';

export type MemberUtilizationOutcome =
  | 'overbook'
  | 'idle'
  | 'healthy'
  | 'mismatch_under'
  | 'mismatch_over';

/** PMO band labels — aligned with findings panel (overbook / idle / healthy / mismatch). */
export function utilizationBandLabels(): {
  overbook: string;
  idle: string;
  healthy: string;
  mismatch: string;
} {
  return {
    overbook: 'Overbook',
    idle: 'Idle',
    healthy: 'Healthy',
    mismatch: 'Mismatch',
  };
}

type MemberMetric = {
  busyRate: number | null;
  effortConsumption: number | null;
};

/** Chart colors — overbook (red) vs mismatch (orange) vs idle (blue) stay visually distinct. */
export const UTILIZATION_OUTCOME_CHART_COLORS = {
  overbook: 'var(--color-danger)',
  /** Saturated — donut / legend swatch. */
  idle: 'var(--color-info)',
  /** Light fill — workload bars keep dark % labels readable. */
  idleBar: 'var(--color-info-tint)',
  healthy: 'var(--color-success)',
  mismatch: 'var(--color-warning)',
} as const;

function outcomeBarColor(outcome: MemberUtilizationOutcome): string {
  if (outcome === 'idle') return UTILIZATION_OUTCOME_CHART_COLORS.idleBar;
  if (outcome === 'overbook') return UTILIZATION_OUTCOME_CHART_COLORS.overbook;
  if (outcome === 'mismatch_under' || outcome === 'mismatch_over') {
    return UTILIZATION_OUTCOME_CHART_COLORS.mismatch;
  }
  return UTILIZATION_OUTCOME_CHART_COLORS.healthy;
}

function buildBandDonutSlices(
  members: MemberMetric[],
  thresholds: DemoThresholds,
  labels: ReturnType<typeof utilizationBandLabels>,
): DonutSlice[] {
  const counts = { overbook: 0, idle: 0, healthy: 0, mismatch: 0 };
  for (const member of members) {
    const outcome = classifyMemberUtilizationOutcome(
      member.busyRate,
      member.effortConsumption,
      thresholds,
    );
    if (outcome === 'overbook') counts.overbook++;
    else if (outcome === 'idle') counts.idle++;
    else if (outcome === 'mismatch_under' || outcome === 'mismatch_over') counts.mismatch++;
    else counts.healthy++;
  }

  const slices: DonutSlice[] = [
    {
      key: 'overbook',
      name: labels.overbook,
      value: counts.overbook,
      color: UTILIZATION_OUTCOME_CHART_COLORS.overbook,
    },
    {
      key: 'idle',
      name: labels.idle,
      value: counts.idle,
      color: UTILIZATION_OUTCOME_CHART_COLORS.idle,
    },
    {
      key: 'healthy',
      name: labels.healthy,
      value: counts.healthy,
      color: UTILIZATION_OUTCOME_CHART_COLORS.healthy,
    },
  ];
  if (counts.mismatch > 0) {
    slices.push({
      key: 'mismatch',
      name: labels.mismatch,
      value: counts.mismatch,
      color: UTILIZATION_OUTCOME_CHART_COLORS.mismatch,
    });
  }
  return slices;
}

function aggregateBusyRateFromFacts(
  facts: Array<{ plannedHours: number; availableHours: number }>,
): number | null {
  let planned = 0;
  let available = 0;
  for (const fact of facts) {
    planned += fact.plannedHours;
    available += fact.availableHours;
  }
  if (available <= 0) return null;
  return planned / available;
}

function aggregateEffortConsumptionFromFacts(
  facts: Array<{ plannedHours: number; loggedHours: number }>,
): number | null {
  let planned = 0;
  let logged = 0;
  for (const fact of facts) {
    planned += fact.plannedHours;
    logged += fact.loggedHours;
  }
  if (planned <= 0) return null;
  return logged / planned;
}

function factsToWorkloadRow(
  key: string,
  label: string,
  busyRate: number | null,
  effortConsumption: number | null,
  thresholds: DemoThresholds,
): CategoricalBarRow | null {
  const pct = busyRatePercent(busyRate);
  if (pct === null) return null;
  const outcome = classifyMemberUtilizationOutcome(busyRate, effortConsumption, thresholds);
  return {
    key,
    label,
    value: pct,
    color: outcomeBarColor(outcome),
  };
}

export type MemberUtilizationBand =
  | 'overbook_red'
  | 'overbook_warn'
  | 'idle_red'
  | 'idle_warn'
  | 'ok'
  | 'unknown';

const OUTCOME_PRIORITY: Record<MemberUtilizationOutcome, number> = {
  overbook: 0,
  idle: 1,
  mismatch_under: 2,
  mismatch_over: 2,
  healthy: 3,
};

export function classifyMemberUtilizationOutcome(
  busyRate: number | null,
  effortConsumption: number | null,
  thresholds: DemoThresholds,
): MemberUtilizationOutcome {
  if (busyRate !== null) {
    const band = classifyMemberUtilizationBand(busyRate, thresholds);
    if (band === 'overbook_red' || band === 'overbook_warn') return 'overbook';
    if (band === 'idle_red' || band === 'idle_warn') return 'idle';
  }
  if (effortConsumption !== null) {
    const drift = Math.abs(effortConsumption - 1);
    if (drift > thresholds.mismatchPctThreshold) {
      return effortConsumption < 1 ? 'mismatch_under' : 'mismatch_over';
    }
  }
  return 'healthy';
}

export function classifyMemberUtilizationBand(
  busyRate: number | null,
  thresholds: DemoThresholds,
): MemberUtilizationBand {
  if (busyRate === null) return 'unknown';
  if (busyRate >= thresholds.overbookRedThreshold) return 'overbook_red';
  if (busyRate > thresholds.overbookThreshold) return 'overbook_warn';
  if (busyRate < thresholds.idleThreshold) return 'idle_red';
  if (busyRate < thresholds.idleYellowThreshold) return 'idle_warn';
  return 'ok';
}

export function busyRatePercent(busyRate: number | null): number | null {
  if (busyRate === null) return null;
  return Math.round(busyRate * 1000) / 10;
}

export function sortWorkloadRowsForDisplay(
  rows: CategoricalBarRow[],
  thresholds: DemoThresholds,
  effortByKey?: Map<string, number | null>,
): CategoricalBarRow[] {
  return [...rows].sort((left, right) => {
    const leftOutcome = classifyMemberUtilizationOutcome(
      left.value / 100,
      effortByKey?.get(left.key) ?? null,
      thresholds,
    );
    const rightOutcome = classifyMemberUtilizationOutcome(
      right.value / 100,
      effortByKey?.get(right.key) ?? null,
      thresholds,
    );
    const bandDiff = OUTCOME_PRIORITY[leftOutcome] - OUTCOME_PRIORITY[rightOutcome];
    if (bandDiff !== 0) return bandDiff;
    if (leftOutcome === 'healthy') return left.label.localeCompare(right.label);
    return Math.abs(right.value - 100) - Math.abs(left.value - 100);
  });
}

export function buildMemberBusyRateRows(
  analyses: DemoMemberAnalysisRow[],
  thresholds: DemoThresholds,
  getMemberLabel: (memberId: string) => string,
): CategoricalBarRow[] {
  const rows: CategoricalBarRow[] = [];
  for (const analysis of analyses) {
    const row = factsToWorkloadRow(
      analysis.memberId,
      getMemberLabel(analysis.memberId),
      analysis.busyRate,
      analysis.effortConsumption,
      thresholds,
    );
    if (row) rows.push(row);
  }
  return rows.sort((left, right) => right.value - left.value);
}

export function buildProjectWorkloadRows(
  data: DemoAnalyticsResult,
  thresholds: DemoThresholds,
  getProjectLabel: (projectId: string) => string,
): CategoricalBarRow[] {
  const membersByProject = new Map<string, Set<string>>();
  const projectNames = new Map<string, string>();
  for (const row of data.projectMemberDependencies) {
    projectNames.set(row.projectId, row.projectName);
    const members = membersByProject.get(row.projectId) ?? new Set<string>();
    members.add(row.memberId);
    membersByProject.set(row.projectId, members);
  }

  const rows: CategoricalBarRow[] = [];
  for (const [projectId, memberIds] of membersByProject) {
    const facts = data.memberWeekFacts.filter(
      (fact) => fact.scopeStatus === 'IN_SCOPE' && memberIds.has(fact.memberId),
    );
    const row = factsToWorkloadRow(
      projectId,
      projectNames.get(projectId) ?? getProjectLabel(projectId),
      aggregateBusyRateFromFacts(facts),
      aggregateEffortConsumptionFromFacts(facts),
      thresholds,
    );
    if (row) rows.push(row);
  }
  return rows.sort((left, right) => right.value - left.value);
}

export function buildWeekWorkloadRows(
  data: DemoAnalyticsResult,
  thresholds: DemoThresholds,
): CategoricalBarRow[] {
  const byWeek = new Map<
    string,
    Array<{ plannedHours: number; availableHours: number; loggedHours: number }>
  >();
  for (const fact of data.memberWeekFacts) {
    if (fact.scopeStatus !== 'IN_SCOPE') continue;
    const bucket = byWeek.get(fact.weekId) ?? [];
    bucket.push({
      plannedHours: fact.plannedHours,
      availableHours: fact.availableHours,
      loggedHours: fact.loggedHours,
    });
    byWeek.set(fact.weekId, bucket);
  }

  const rows: CategoricalBarRow[] = [];
  for (const [weekId, facts] of byWeek) {
    const row = factsToWorkloadRow(
      weekId,
      weekId,
      aggregateBusyRateFromFacts(facts),
      aggregateEffortConsumptionFromFacts(facts),
      thresholds,
    );
    if (row) rows.push(row);
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

export function buildProjectWorkloadMetrics(data: DemoAnalyticsResult): MemberMetric[] {
  const membersByProject = new Map<string, Set<string>>();
  for (const row of data.projectMemberDependencies) {
    const members = membersByProject.get(row.projectId) ?? new Set<string>();
    members.add(row.memberId);
    membersByProject.set(row.projectId, members);
  }

  const metrics: MemberMetric[] = [];
  for (const memberIds of membersByProject.values()) {
    const facts = data.memberWeekFacts.filter(
      (fact) => fact.scopeStatus === 'IN_SCOPE' && memberIds.has(fact.memberId),
    );
    metrics.push({
      busyRate: aggregateBusyRateFromFacts(facts),
      effortConsumption: aggregateEffortConsumptionFromFacts(facts),
    });
  }
  return metrics;
}

export function buildWeekWorkloadMetrics(data: DemoAnalyticsResult): MemberMetric[] {
  const byWeek = new Map<
    string,
    Array<{ plannedHours: number; availableHours: number; loggedHours: number }>
  >();
  for (const fact of data.memberWeekFacts) {
    if (fact.scopeStatus !== 'IN_SCOPE') continue;
    const bucket = byWeek.get(fact.weekId) ?? [];
    bucket.push({
      plannedHours: fact.plannedHours,
      availableHours: fact.availableHours,
      loggedHours: fact.loggedHours,
    });
    byWeek.set(fact.weekId, bucket);
  }

  const metrics: MemberMetric[] = [];
  for (const facts of byWeek.values()) {
    metrics.push({
      busyRate: aggregateBusyRateFromFacts(facts),
      effortConsumption: aggregateEffortConsumptionFromFacts(facts),
    });
  }
  return metrics;
}

export function buildWorkloadDonutSlices(
  rows: CategoricalBarRow[],
  thresholds: DemoThresholds,
  metrics?: MemberMetric[],
): DonutSlice[] {
  const members =
    metrics ??
    rows.map((row) => ({
      busyRate: row.value / 100,
      effortConsumption: null,
    }));
  return buildBandDonutSlices(members, thresholds, utilizationBandLabels());
}

export function buildFindingsDonutSlices(
  analyses: DemoMemberAnalysisRow[],
  thresholds: DemoThresholds,
): DonutSlice[] {
  return buildBandDonutSlices(
    analyses.map((analysis) => ({
      busyRate: analysis.busyRate,
      effortConsumption: analysis.effortConsumption,
    })),
    thresholds,
    utilizationBandLabels(),
  );
}

export function buildThresholdReferenceLines(thresholds: DemoThresholds): ChartReferenceLine[] {
  const pct = (rate: number) => Math.round(rate * 1000) / 10;
  return [
    {
      value: pct(thresholds.idleThreshold),
      label: `Idle ${Math.round(thresholds.idleThreshold * 100)}%`,
      stroke: 'var(--color-danger)',
    },
    {
      value: pct(thresholds.idleYellowThreshold),
      label: `Idle warn ${Math.round(thresholds.idleYellowThreshold * 100)}%`,
      stroke: 'var(--color-ink-subtle)',
      strokeDasharray: '2 4',
    },
    {
      value: pct(thresholds.overbookThreshold),
      label: `Overbook ${Math.round(thresholds.overbookThreshold * 100)}%`,
      stroke: 'var(--color-warning)',
    },
    {
      value: pct(thresholds.overbookRedThreshold),
      label: `Overbook red ${Math.round(thresholds.overbookRedThreshold * 100)}%`,
      stroke: 'var(--color-danger)',
      strokeDasharray: '2 4',
    },
  ];
}

export function buildMemberWeekTimelineRows(
  data: DemoAnalyticsResult,
  memberId: string,
): Array<{ label: string; busyRate: number }> {
  return data.memberWeekFacts
    .filter((fact) => fact.memberId === memberId && fact.scopeStatus === 'IN_SCOPE')
    .map((fact) => ({
      label: fact.weekId,
      busyRate: busyRatePercent(fact.busyRate) ?? 0,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
