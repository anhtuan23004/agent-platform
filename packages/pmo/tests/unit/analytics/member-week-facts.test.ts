import { describe, expect, it } from 'vitest';
import {
  analyzeMembers,
  detectMismatch,
  detectOverbookIdle,
  type FindingsContext,
} from '../../../src/backend/analytics/findings.ts';
import { buildMemberWeekFacts } from '../../../src/backend/analytics/member-week-facts.ts';
import type {
  AllocationRow,
  Finding,
  LeaveRow,
  MemberRow,
  MemberWeekFact,
  TimesheetRow,
  WeekRow,
} from '../../../src/backend/analytics/types.ts';
import { DEFAULT_THRESHOLDS } from '../../../src/backend/analytics/types.ts';

// ── PMO_02 calendar window (W1–W6) ───────────────────────────────────────────
const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const WEEKS: WeekRow[] = [
  {
    week_id: 'W1',
    week_start: d('2026-06-29'),
    week_end: d('2026-07-03'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
  {
    week_id: 'W2',
    week_start: d('2026-07-06'),
    week_end: d('2026-07-10'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
  {
    week_id: 'W3',
    week_start: d('2026-07-13'),
    week_end: d('2026-07-17'),
    working_days: 4,
    holiday_hours_ft: 8,
  },
  {
    week_id: 'W4',
    week_start: d('2026-07-20'),
    week_end: d('2026-07-24'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
  {
    week_id: 'W5',
    week_start: d('2026-07-27'),
    week_end: d('2026-07-31'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
  {
    week_id: 'W6',
    week_start: d('2026-08-03'),
    week_end: d('2026-08-07'),
    working_days: 5,
    holiday_hours_ft: 0,
  },
];
const WEEKS_BY_ID = new Map(WEEKS.map((w) => [w.week_id, w]));

const WINDOW_START = d('2026-06-29');
const WINDOW_END = d('2026-08-07');

function ftMember(id: string, joinDate = '2020-01-01', std = 40): MemberRow {
  return { member_id: id, full_name: id, std_hours_week: std, join_date: d(joinDate) };
}

function alloc(member: string, project: string, hours: number): AllocationRow {
  return {
    member_id: member,
    project_id: project,
    weekly_planned_hours: hours,
    start_date: WINDOW_START,
    end_date: WINDOW_END,
  };
}

/** One synthetic timesheet entry per week carrying that week's total, placed on week_start. */
function weeklyLogs(member: string, perWeek: Partial<Record<string, number>>): TimesheetRow[] {
  return WEEKS.filter((w) => perWeek[w.week_id] !== undefined).map((w) => ({
    member_id: member,
    work_date: w.week_start,
    logged_hours: perWeek[w.week_id] ?? 0,
  }));
}

/** Same logged hours in every week (normal-week members). */
function flatLogs(member: string, hours: number): TimesheetRow[] {
  return weeklyLogs(member, Object.fromEntries(WEEKS.map((w) => [w.week_id, hours])));
}

function ctx(leaves: LeaveRow[] = []): FindingsContext {
  return { leaves, weeksById: WEEKS_BY_ID, thresholds: DEFAULT_THRESHOLDS };
}

function factOf(facts: MemberWeekFact[], member: string, week: string): MemberWeekFact {
  const f = facts.find((x) => x.memberId === member && x.weekId === week);
  if (!f) throw new Error(`fact not found: ${member}/${week}`);
  return f;
}

function maybeFinding(findings: Finding[], member: string): Finding | undefined {
  return findings.find((x) => x.memberId === member);
}

describe('PMO_02 analytics — Answer_Key F-07..F-17', () => {
  it('F-07 EMP-004: overbook red (busy 125%)', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-004')],
      allocations: [alloc('EMP-004', 'PRJ-001', 32), alloc('EMP-004', 'PRJ-002', 18)],
      timesheets: flatLogs('EMP-004', 48),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const finding = maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-004');
    expect(finding?.busyRate).toBe(1.25);
    expect(finding?.issueType).toBe('overbook');
    expect(finding?.ragColor).toBe('red');
  });

  it('F-08 EMP-001: overbook yellow (busy 115%)', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-001')],
      allocations: [alloc('EMP-001', 'PRJ-001', 24), alloc('EMP-001', 'PRJ-003', 22)],
      timesheets: flatLogs('EMP-001', 45),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const finding = maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-001');
    expect(finding?.busyRate).toBeCloseTo(1.15, 5);
    expect(finding?.issueType).toBe('overbook');
    expect(finding?.ragColor).toBe('yellow');
  });

  it('F-09/F-10 EMP-005 & EMP-008: idle (busy 60% / 50%)', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-005'), ftMember('EMP-008')],
      allocations: [
        alloc('EMP-005', 'PRJ-001', 12),
        alloc('EMP-005', 'PRJ-002', 12),
        alloc('EMP-008', 'PRJ-002', 20),
      ],
      timesheets: [...flatLogs('EMP-005', 23), ...flatLogs('EMP-008', 19)],
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const findings = detectOverbookIdle(facts, ctx());
    expect(maybeFinding(findings, 'EMP-005')?.issueType).toBe('idle');
    expect(maybeFinding(findings, 'EMP-005')?.busyRate).toBe(0.6);
    expect(maybeFinding(findings, 'EMP-008')?.issueType).toBe('idle');
    expect(maybeFinding(findings, 'EMP-008')?.busyRate).toBe(0.5);
  });

  it('F-11 EMP-002: mismatch_under (EC ~53%)', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-002')],
      allocations: [alloc('EMP-002', 'PRJ-002', 36)],
      timesheets: weeklyLogs('EMP-002', { W1: 20, W2: 18, W3: 16, W4: 20, W5: 20, W6: 18 }),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    // not overbook/idle
    expect(maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-002')).toBeUndefined();
    const finding = maybeFinding(detectMismatch(facts, ctx()), 'EMP-002');
    expect(finding?.issueType).toBe('mismatch_under');
    expect(finding?.effortConsumption).toBeLessThan(0.6);
    expect(finding?.effortConsumption).toBeGreaterThan(0.45);
  });

  it('F-12 EMP-006: mismatch_over, genuine (no approved OT; holiday week excluded)', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-006')],
      allocations: [alloc('EMP-006', 'PRJ-001', 38)],
      timesheets: weeklyLogs('EMP-006', { W1: 48, W2: 48, W3: 38, W4: 48, W5: 50, W6: 48 }),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const finding = maybeFinding(detectMismatch(facts, ctx()), 'EMP-006');
    expect(finding?.issueType).toBe('mismatch_over');
    expect(finding?.effortConsumption).toBeGreaterThan(1.2);
    expect(finding?.excludedWeeks).toEqual([{ weekId: 'W3', reason: 'holiday_week' }]);
  });

  it('F-13 EMP-003: leave + approved OT → NOT flagged; weeks excluded with reasons', () => {
    const leaves: LeaveRow[] = [
      ...['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'].map((day) => ({
        member_id: 'EMP-003',
        leave_date: d(day),
        leave_type: 'Annual Leave',
        approved: true,
        duration_days: 1,
      })),
      ...['2026-07-27', '2026-07-28'].map((day) => ({
        member_id: 'EMP-003',
        leave_date: d(day),
        leave_type: 'Approved OT Comp',
        approved: true,
        duration_days: 1,
      })),
    ];
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-003')],
      allocations: [alloc('EMP-003', 'PRJ-002', 40)],
      timesheets: weeklyLogs('EMP-003', { W1: 40, W2: 0, W3: 24, W4: 40, W5: 52, W6: 40 }),
      leaves,
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });

    // W2 full leave → available collapses to 0
    expect(factOf(facts, 'EMP-003', 'W2').availableHours).toBe(0);

    // No genuine mismatch finding
    expect(maybeFinding(detectMismatch(facts, ctx(leaves)), 'EMP-003')).toBeUndefined();
    expect(maybeFinding(detectOverbookIdle(facts, ctx(leaves)), 'EMP-003')).toBeUndefined();

    // Excluded weeks recorded with reasons
    const analysis = analyzeMembers(facts, ctx(leaves)).find((a) => a.memberId === 'EMP-003');
    expect(analysis?.excludedWeeks).toContainEqual({ weekId: 'W2', reason: 'approved_leave' });
    expect(analysis?.excludedWeeks).toContainEqual({ weekId: 'W5', reason: 'approved_ot' });
  });

  it('F-14 W3 holiday week: proportional log is NOT flagged', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-XX')],
      allocations: [alloc('EMP-XX', 'PRJ-001', 40)],
      timesheets: weeklyLogs('EMP-XX', { W1: 40, W2: 40, W3: 32, W4: 40, W5: 40, W6: 40 }),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    const w3 = factOf(facts, 'EMP-XX', 'W3');
    expect(w3.availableHours).toBe(32); // 40 × 4/5
    // Per-week N06 is logged / planned; holiday weeks are excluded at member-level aggregation.
    expect(w3.effortConsumption).toBeCloseTo(0.8, 5); // 32 / 40
    const analysis = analyzeMembers(facts, ctx()).find((a) => a.memberId === 'EMP-XX');
    expect(analysis?.excludedWeeks).toContainEqual({ weekId: 'W3', reason: 'holiday_week' });
    expect(maybeFinding(detectMismatch(facts, ctx()), 'EMP-XX')).toBeUndefined();
  });

  it('F-15 EMP-009: pre-hire weeks PRE_HIRE, not flagged idle', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-009', '2026-07-14')],
      allocations: [{ ...alloc('EMP-009', 'PRJ-002', 32), start_date: d('2026-07-13') }],
      timesheets: weeklyLogs('EMP-009', { W3: 24, W4: 28, W5: 32, W6: 32 }),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(factOf(facts, 'EMP-009', 'W1').scopeStatus).toBe('PRE_HIRE');
    expect(factOf(facts, 'EMP-009', 'W2').scopeStatus).toBe('PRE_HIRE');
    expect(factOf(facts, 'EMP-009', 'W3').scopeStatus).toBe('IN_SCOPE');
    // busy 32/40 = 0.8 → not idle, not overbook
    expect(maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-009')).toBeUndefined();
  });

  it('F-16 EMP-010: deduped RA sums to 44h (busy 110% OK), not 64h', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-010')],
      allocations: [alloc('EMP-010', 'PRJ-001', 24), alloc('EMP-010', 'PRJ-002', 20)],
      timesheets: flatLogs('EMP-010', 43),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(factOf(facts, 'EMP-010', 'W1').plannedHours).toBe(44);
    expect(factOf(facts, 'EMP-010', 'W1').busyRate).toBeCloseTo(1.1, 5);
    // 1.10 is not > 1.10 → no overbook finding
    expect(maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-010')).toBeUndefined();
  });

  it('F-17 EMP-007: part-time normalized to 20h → busy 80% OK', () => {
    const facts = buildMemberWeekFacts({
      members: [ftMember('EMP-007', '2020-01-01', 20)],
      allocations: [alloc('EMP-007', 'PRJ-002', 16)],
      timesheets: flatLogs('EMP-007', 15),
      leaves: [],
      weeks: WEEKS,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(factOf(facts, 'EMP-007', 'W1').availableHours).toBe(20);
    expect(factOf(facts, 'EMP-007', 'W1').busyRate).toBe(0.8);
    expect(maybeFinding(detectOverbookIdle(facts, ctx()), 'EMP-007')).toBeUndefined();
  });
});
