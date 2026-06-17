/**
 * Run PMO analytics against repo-root `mock-data.db` (SQLite) and write
 * `packages/pmo/reports/pmo_02_mock_report.md`.
 *
 * Compares raw workbook rows vs cleaned canonical DB, then runs analytics.
 *
 * Usage:
 *   node --experimental-strip-types packages/pmo/scripts/generate-mock-report.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  analyzeMembers,
  detectMismatch,
  detectOverbookIdle,
} from '../src/backend/analytics/findings.ts';
import { buildMemberWeekFacts } from '../src/backend/analytics/member-week-facts.ts';
import { resolveThresholds } from '../src/backend/analytics/thresholds.ts';
import type { Finding, SuppressionReason } from '../src/backend/analytics/types.ts';
import {
  computeCleaningSummary,
  describeAnswerKeyOutcome,
  loadRawNormalizedTables,
} from './lib/mock-cleaning-outcomes.ts';
import {
  DEFAULT_MOCK_DB_PATH,
  loadCanonicalFromSqlite,
  queryScalar,
} from './lib/mock-sqlite-canonical.ts';

const REPORT_PATH = resolve(import.meta.dirname, '../reports/pmo_02_mock_report.md');

/** Answer_Key expected issues for EMP-001..EMP-010 (member-level). */
const ANSWER_KEY: Record<string, string> = {
  'EMP-001': 'Overbook',
  'EMP-002': 'Mismatch_underlog',
  'EMP-003': 'Edge_exclude',
  'EMP-004': 'Overbook',
  'EMP-005': 'Idle',
  'EMP-006': 'Mismatch_overlog',
  'EMP-007': 'Guardrail_parttime',
  'EMP-008': 'Idle',
  'EMP-009': 'Edge_onboard_missing',
  'EMP-010': 'Data_duplicate',
};

const ANALYTICS_EXPECTED = new Set(['Overbook', 'Idle', 'Mismatch_underlog', 'Mismatch_overlog']);

function findingLabel(f: Finding): string {
  switch (f.issueType) {
    case 'overbook':
      return 'Overbook';
    case 'idle':
      return 'Idle';
    case 'mismatch_under':
      return 'Mismatch_underlog';
    case 'mismatch_over':
      return 'Mismatch_overlog';
    default:
      return f.issueType;
  }
}

function formatRate(n: number | null): string {
  if (n === null) return '';
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

function countByIssueType(findings: Finding[]) {
  return {
    idle: findings.filter((f) => f.issueType === 'idle').length,
    mismatch_over: findings.filter((f) => f.issueType === 'mismatch_over').length,
    mismatch_under: findings.filter((f) => f.issueType === 'mismatch_under').length,
    overbook: findings.filter((f) => f.issueType === 'overbook').length,
  };
}

function countExcludedWeeks(analyses: ReturnType<typeof analyzeMembers>) {
  const counts: Partial<Record<SuppressionReason, number>> = {};
  for (const a of analyses) {
    for (const ex of a.excludedWeeks) {
      counts[ex.reason] = (counts[ex.reason] ?? 0) + 1;
    }
  }
  return counts;
}

function answerKeyMatch(expected: string, analyticsFinding: string): string {
  if (ANALYTICS_EXPECTED.has(expected)) {
    return analyticsFinding === expected ? 'pass' : 'fail';
  }
  return analyticsFinding === '' ? 'pass' : 'fail';
}

async function main() {
  const rawTables = await loadRawNormalizedTables();
  const cleaning = computeCleaningSummary(rawTables);

  const inputs = loadCanonicalFromSqlite(DEFAULT_MOCK_DB_PATH);
  const thresholds = resolveThresholds(inputs.configRows);

  const facts = buildMemberWeekFacts({ ...inputs, thresholds });
  const ctx = {
    leaves: inputs.leaves,
    weeksById: new Map(inputs.weeks.map((w) => [w.week_id, w])),
    thresholds,
  };

  const findings = [...detectOverbookIdle(facts, ctx), ...detectMismatch(facts, ctx)].sort((a, b) =>
    a.memberId.localeCompare(b.memberId),
  );
  const analyses = analyzeMembers(facts, ctx);
  const analysisByMember = new Map(analyses.map((a) => [a.memberId, a]));
  const excludedCounts = countExcludedWeeks(analyses);
  const byType = countByIssueType(findings);

  const findingsByMember = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = findingsByMember.get(f.memberId) ?? [];
    list.push(f);
    findingsByMember.set(f.memberId, list);
  }

  const factsByMember = new Map<string, typeof facts>();
  for (const fact of facts) {
    const list = factsByMember.get(fact.memberId) ?? [];
    list.push(fact);
    factsByMember.set(fact.memberId, list);
  }

  const topFindings = [...findings]
    .sort((a, b) => (b.busyRate ?? 0) - (a.busyRate ?? 0))
    .slice(0, 30);

  const db = DEFAULT_MOCK_DB_PATH;
  const { resourceAllocation: ra, timesheet: ts, raDuplicates } = cleaning;

  const lines: string[] = [
    '## PMO_02 mock-data.db report (raw → clean → analytics)',
    '',
    `- Source workbook: \`hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx\``,
    `- SQLite DB: \`mock-data.db\``,
    '',
    '### Cleaning summary (raw workbook → canonical DB)',
    `- resource_allocation: **${ra.rawRows}** raw → **${ra.cleanRows}** clean (${ra.duplicatesRemoved} duplicate row(s) removed)`,
    `- timesheet: **${ts.rawRows}** raw → **${ts.cleanRows}** clean (${ts.rowsAggregated} row(s) aggregated)`,
    '',
  ];

  if (raDuplicates.length > 0) {
    lines.push(
      '#### RA duplicates removed',
      'member_id | project_id | raw_count | removed | planned_h/row',
      '---|---|---:|---:|---:',
      ...raDuplicates.map(
        (d) => `${d.memberId}|${d.projectId}|${d.rawCount}|${d.removed}|${d.plannedHoursPerRow}`,
      ),
      '',
    );
  }

  lines.push(
    '### Canonical inputs (post-clean DB)',
    `- weeks: **${queryScalar(db, 'SELECT count(*) FROM pmo_calendar_weeks')}**`,
    `- members: **${queryScalar(db, 'SELECT count(*) FROM pmo_member_master')}**`,
    `- allocs: **${queryScalar(db, 'SELECT count(*) FROM pmo_resource_allocations')}**`,
    `- timesheets: **${queryScalar(db, 'SELECT count(*) FROM pmo_timesheets')}**`,
    `- leaves: **${queryScalar(db, 'SELECT count(*) FROM pmo_leave_records')}**`,
    '',
    '### Thresholds (from overbook_idle_config)',
    `- overbook_threshold: **${thresholds.overbookThreshold}**`,
    `- overbook_red_threshold: **${thresholds.overbookRedThreshold}**`,
    `- idle_threshold: **${thresholds.idleThreshold}**`,
    `- mismatch_pct_threshold: **${thresholds.mismatchPctThreshold}**`,
    '',
    '### Analytics finding counts',
    `- Idle: **${byType.idle}**`,
    `- Mismatch_overlog: **${byType.mismatch_over}**`,
    `- Mismatch_underlog: **${byType.mismatch_under}**`,
    `- Overbook: **${byType.overbook}**`,
    '',
    '### Top analytics findings (first 30)',
    'member_id | issue | rag | busyRate | effortConsumption',
    '---|---|---:|---:|---:',
    ...topFindings.map(
      (f) =>
        `${f.memberId}|${findingLabel(f)}|${f.ragColor}|${formatRate(f.busyRate)}|${formatRate(f.effortConsumption)}`,
    ),
    '',
    '### Excluded weeks (member-level, analytics)',
    `- approved_leave: **${excludedCounts.approved_leave ?? 0}**`,
    `- approved_ot: **${excludedCounts.approved_ot ?? 0}**`,
    `- holiday_week: **${excludedCounts.holiday_week ?? 0}**`,
    `- training: **${excludedCounts.training ?? 0}**`,
    '',
    '### Answer Key comparison (member-level)',
    'member_id | expected | cleaning_outcome | analytics_finding | match',
    '---|---|---|---|---',
    ...Object.keys(ANSWER_KEY)
      .sort()
      .map((memberId) => {
        const expected = ANSWER_KEY[memberId] ?? '';
        const memberFindings = findingsByMember.get(memberId) ?? [];
        const analyticsFinding = memberFindings.map(findingLabel).join(', ');
        const cleaningOutcome = describeAnswerKeyOutcome(memberId, expected, {
          analysis: analysisByMember.get(memberId),
          memberFacts: factsByMember.get(memberId) ?? [],
          memberFindings,
          cleaning,
        });
        return `${memberId}|${expected}|${cleaningOutcome}|${analyticsFinding || '(none)'}|${answerKeyMatch(expected, analyticsFinding)}`;
      }),
    '',
  );

  writeFileSync(REPORT_PATH, lines.join('\n'));
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(
    `cleaning: RA ${ra.rawRows}→${ra.cleanRows} (-${ra.duplicatesRemoved} dup); findings: overbook=${byType.overbook} idle=${byType.idle}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
