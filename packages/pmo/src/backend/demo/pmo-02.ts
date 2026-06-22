import type {
  AllocationRow,
  LeaveRow,
  MemberRow,
  ProjectRow,
  TimesheetRow,
  WeekRow,
} from '../analytics/types.ts';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export const PMO_02_WEEKS: WeekRow[] = [
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

export const PMO_02_WINDOW = { start: d('2026-06-29'), end: d('2026-08-07') };

function ftMember(id: string, joinDate = '2020-01-01', std = 40): MemberRow {
  return { member_id: id, full_name: id, std_hours_week: std, join_date: d(joinDate) };
}

const PROJECT_LIFECYCLE: Record<string, { start: string; end: string }> = {
  'PRJ-001': { start: '2026-05-19', end: '2026-12-19' },
  'PRJ-002': { start: '2026-04-06', end: '2026-12-31' },
  'PRJ-003': { start: '2026-06-01', end: '2026-10-31' },
};

function proj(id: string): ProjectRow {
  const lifecycle = PROJECT_LIFECYCLE[id];
  return {
    project_id: id,
    project_name: id,
    account_id: null,
    project_type: null,
    status: 'Active',
    pm_id: null,
    start_date: lifecycle ? d(lifecycle.start) : null,
    end_date: lifecycle ? d(lifecycle.end) : null,
  };
}

function alloc(member: string, project: string, hours: number, stdHoursWeek = 40): AllocationRow {
  return {
    member_id: member,
    project_id: project,
    role: null,
    allocation_pct: hours / stdHoursWeek,
    weekly_planned_hours: hours,
    start_date: PMO_02_WINDOW.start,
    end_date: PMO_02_WINDOW.end,
  };
}

function weeklyLogs(member: string, perWeek: Partial<Record<string, number>>): TimesheetRow[] {
  return PMO_02_WEEKS.filter((w) => perWeek[w.week_id] !== undefined).map((w) => ({
    member_id: member,
    work_date: w.week_start,
    logged_hours: perWeek[w.week_id] ?? 0,
  }));
}

function flatLogs(member: string, hours: number): TimesheetRow[] {
  return weeklyLogs(member, Object.fromEntries(PMO_02_WEEKS.map((w) => [w.week_id, hours])));
}

/** Answer_Key members F-07..F-17 — synthetic canonical inputs for demo / tests. */
export function buildPmo02AnswerKeyFixture(): {
  members: MemberRow[];
  projects: ProjectRow[];
  allocations: AllocationRow[];
  timesheets: TimesheetRow[];
  leaves: LeaveRow[];
  weeks: WeekRow[];
} {
  const emp003Leaves: LeaveRow[] = [
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

  return {
    weeks: PMO_02_WEEKS,
    members: [
      ftMember('EMP-001'),
      ftMember('EMP-002'),
      ftMember('EMP-003'),
      ftMember('EMP-004'),
      ftMember('EMP-005'),
      ftMember('EMP-008'),
      ftMember('EMP-006'),
      ftMember('EMP-007', '2020-01-01', 20),
      ftMember('EMP-009', '2026-07-14'),
      ftMember('EMP-010'),
    ],
    projects: [proj('PRJ-001'), proj('PRJ-002'), proj('PRJ-003')],
    allocations: [
      alloc('EMP-001', 'PRJ-001', 24),
      alloc('EMP-001', 'PRJ-003', 22),
      alloc('EMP-002', 'PRJ-002', 36),
      alloc('EMP-003', 'PRJ-002', 40),
      alloc('EMP-004', 'PRJ-001', 32),
      alloc('EMP-004', 'PRJ-002', 18),
      alloc('EMP-005', 'PRJ-001', 12),
      alloc('EMP-005', 'PRJ-002', 12),
      alloc('EMP-008', 'PRJ-002', 20),
      alloc('EMP-006', 'PRJ-001', 38),
      alloc('EMP-007', 'PRJ-002', 16, 20),
      { ...alloc('EMP-009', 'PRJ-002', 32), start_date: d('2026-07-13') },
      alloc('EMP-010', 'PRJ-001', 24),
      alloc('EMP-010', 'PRJ-002', 20),
    ],
    timesheets: [
      ...flatLogs('EMP-001', 45),
      ...weeklyLogs('EMP-002', { W1: 20, W2: 18, W3: 16, W4: 20, W5: 20, W6: 18 }),
      ...weeklyLogs('EMP-003', { W1: 40, W2: 0, W3: 24, W4: 40, W5: 52, W6: 40 }),
      ...flatLogs('EMP-004', 48),
      ...flatLogs('EMP-005', 23),
      ...flatLogs('EMP-008', 19),
      ...weeklyLogs('EMP-006', { W1: 48, W2: 48, W3: 38, W4: 48, W5: 50, W6: 48 }),
      ...flatLogs('EMP-007', 15),
      ...weeklyLogs('EMP-009', { W3: 24, W4: 28, W5: 32, W6: 32 }),
      ...flatLogs('EMP-010', 43),
    ],
    leaves: emp003Leaves,
  };
}

export const PMO_02_ANSWER_KEY = [
  { memberId: 'EMP-001', expected: 'Overbook' },
  { memberId: 'EMP-002', expected: 'Mismatch_underlog' },
  { memberId: 'EMP-003', expected: '(none)' },
  { memberId: 'EMP-004', expected: 'Overbook' },
  { memberId: 'EMP-005', expected: 'Idle' },
  { memberId: 'EMP-006', expected: 'Mismatch_overlog' },
  { memberId: 'EMP-007', expected: '(none)' },
  { memberId: 'EMP-008', expected: 'Idle' },
  { memberId: 'EMP-009', expected: '(none)' },
  { memberId: 'EMP-010', expected: '(none)' },
] as const;
