import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { MemberAnalysis } from '../../src/backend/analytics/findings.ts';
import type { Finding, MemberWeekFact } from '../../src/backend/analytics/types.ts';
import { detectSchema } from '../../src/backend/ingestion/detect-schema.ts';
import { type NormalizedRow, normalizeRows } from '../../src/backend/ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../src/backend/ingestion/parse-workbook.ts';
import {
  aggregateTimesheetRows,
  computeNaturalKeyHash,
} from '../../src/backend/ingestion/stage-changes.ts';

export const DEFAULT_WORKBOOK_PATH = resolve(
  import.meta.dirname,
  '../../../../hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx',
);
export const MOCK_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface RaDuplicateOutcome {
  memberId: string;
  projectId: string;
  rawCount: number;
  removed: number;
  plannedHoursPerRow: number;
}

export interface CleaningSummary {
  resourceAllocation: {
    rawRows: number;
    cleanRows: number;
    duplicatesRemoved: number;
  };
  timesheet: {
    rawRows: number;
    cleanRows: number;
    rowsAggregated: number;
  };
  raDuplicates: RaDuplicateOutcome[];
}

function dedupeResourceAllocation(rows: NormalizedRow[], tenantId: string): NormalizedRow[] {
  const seen = new Set<string>();
  const out: NormalizedRow[] = [];
  for (const r of rows) {
    const k = computeNaturalKeyHash('resource_allocation', tenantId, r.values);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export async function loadRawNormalizedTables(
  workbookPath: string = DEFAULT_WORKBOOK_PATH,
): Promise<Record<string, NormalizedRow[]>> {
  const buffer = readFileSync(workbookPath);
  const detected = await detectSchema(buffer);
  const parseResult = await parseWorkbook(buffer);
  const confirmed = detected.tables.map((t) => ({
    ...t,
    mappings: t.mappings.filter((m) => m.status !== 'blocked'),
  }));
  return normalizeRows(parseResult.sheets, confirmed).tables;
}

export function computeCleaningSummary(
  rawTables: Record<string, NormalizedRow[]>,
  tenantId: string = MOCK_TENANT_ID,
): CleaningSummary {
  const rawRa = rawTables.resource_allocation ?? [];
  const cleanRa = dedupeResourceAllocation(rawRa, tenantId);

  const keyCounts = new Map<
    string,
    { memberId: string; projectId: string; count: number; plannedHoursPerRow: number }
  >();
  for (const r of rawRa) {
    const memberId = String(r.values.member_id ?? '');
    const projectId = String(r.values.project_id ?? '');
    const hash = computeNaturalKeyHash('resource_allocation', tenantId, r.values);
    const existing = keyCounts.get(hash);
    if (existing) {
      existing.count += 1;
    } else {
      keyCounts.set(hash, {
        memberId,
        projectId,
        count: 1,
        plannedHoursPerRow: Number(r.values.weekly_planned_hours ?? 0),
      });
    }
  }

  const raDuplicates = [...keyCounts.values()]
    .filter((e) => e.count > 1)
    .map((e) => ({
      memberId: e.memberId,
      projectId: e.projectId,
      rawCount: e.count,
      removed: e.count - 1,
      plannedHoursPerRow: e.plannedHoursPerRow,
    }))
    .sort((a, b) => a.memberId.localeCompare(b.memberId));

  const rawTs = rawTables.timesheet ?? [];
  const cleanTs = aggregateTimesheetRows(tenantId, rawTs);

  return {
    resourceAllocation: {
      rawRows: rawRa.length,
      cleanRows: cleanRa.length,
      duplicatesRemoved: rawRa.length - cleanRa.length,
    },
    timesheet: {
      rawRows: rawTs.length,
      cleanRows: cleanTs.length,
      rowsAggregated: rawTs.length - cleanTs.length,
    },
    raDuplicates,
  };
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return `${Math.round(n * 100)}%`;
}

/** Human-readable cleaning / edge outcome for Answer_Key members. */
export function describeAnswerKeyOutcome(
  memberId: string,
  answerKeyType: string,
  opts: {
    analysis?: MemberAnalysis;
    memberFacts: MemberWeekFact[];
    memberFindings: Finding[];
    cleaning: CleaningSummary;
  },
): string {
  const { analysis, memberFacts, memberFindings, cleaning } = opts;

  switch (answerKeyType) {
    case 'Data_duplicate': {
      const dup = cleaning.raDuplicates.find((d) => d.memberId === memberId);
      if (!dup) return 'no RA duplicate in raw data';
      const inScope = memberFacts.find((f) => f.scopeStatus === 'IN_SCOPE');
      const plannedClean = inScope?.plannedHours ?? 0;
      const wouldBePlanned = plannedClean + dup.plannedHoursPerRow * dup.removed;
      const analytics =
        memberFindings.length === 0 ? 'no overbook after clean' : findingLabels(memberFindings);
      return `deduped ${dup.removed} RA row (${memberId}×${dup.projectId}); planned ${plannedClean}h clean (raw sum would be ${wouldBePlanned}h); ${analytics}`;
    }
    case 'Edge_exclude': {
      const ex = analysis?.excludedWeeks ?? [];
      if (ex.length === 0) return 'no excluded weeks';
      return `excluded weeks: ${ex.map((e) => `${e.weekId} (${e.reason})`).join(', ')}`;
    }
    case 'Guardrail_parttime':
      return `part-time std normalized; member busy ${pct(analysis?.busyRate)}; no false idle`;
    case 'Edge_onboard_missing': {
      const preHire = memberFacts.filter((f) => f.scopeStatus === 'PRE_HIRE').map((f) => f.weekId);
      return `PRE_HIRE ${preHire.join('+') || 'none'}; in-scope busy ${pct(analysis?.busyRate)}; missing pre-hire data not flagged idle`;
    }
    default:
      return cleaning.raDuplicates.some((d) => d.memberId === memberId)
        ? 'see Data_duplicate cleaning above'
        : 'no ingestion clean action';
  }
}

function findingLabels(findings: Finding[]): string {
  return findings
    .map((f) => {
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
    })
    .join(', ');
}
