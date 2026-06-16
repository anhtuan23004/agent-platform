// ── PMO_02 Analytics — shared types ──────────────────────────────────────────
// Pure analytics layer: member × week utilization facts, RAG classification,
// and edge-case suppression. No DB access here — see persist-facts.ts.

export type ScopeStatus = 'IN_SCOPE' | 'PRE_HIRE';

export type RagColor = 'green' | 'yellow' | 'red' | 'none';

export type IssueType = 'overbook' | 'idle' | 'mismatch_under' | 'mismatch_over' | 'ok';

export type SuppressionReason = 'pre_hire' | 'holiday_week' | 'approved_leave' | 'approved_ot';

// ── Source row shapes (subset of canonical tables this layer reads) ──────────

export interface MemberRow {
  member_id: string;
  std_hours_week: number | null;
  join_date: Date | null;
}

export interface AllocationRow {
  member_id: string;
  project_id: string;
  weekly_planned_hours: number | null;
  start_date: Date;
  end_date: Date;
}

export interface TimesheetRow {
  member_id: string;
  work_date: Date;
  logged_hours: number;
  log_category?: string | null;
}

export interface LeaveRow {
  member_id: string | null;
  leave_date: Date;
  leave_type: string;
  approved: boolean | null;
  duration_days: number | null;
}

export interface WeekRow {
  week_id: string;
  week_start: Date;
  week_end: Date;
  working_days: number;
  holiday_hours_ft: number | null;
}

// ── Thresholds (resolved from overbook_idle_config) ──────────────────────────

export interface Thresholds {
  overbookThreshold: number; // busy > this → overbook (yellow)
  overbookRedThreshold: number; // busy > this → overbook (red)
  idleThreshold: number; // busy < this → idle
  mismatchPctThreshold: number; // |ec - 1| > this → mismatch
  otMaxHoursPerWeek: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  overbookThreshold: 1.1,
  overbookRedThreshold: 1.2,
  idleThreshold: 0.75,
  mismatchPctThreshold: 0.2,
  otMaxHoursPerWeek: 48,
};

// ── Derived facts and findings ───────────────────────────────────────────────

export interface MemberWeekFact {
  memberId: string;
  weekId: string;
  scopeStatus: ScopeStatus;
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  expectedLoggedHours: number;
  billableHours?: number;
  benchHours?: number;
  overtimeHours?: number;
  // Metrics per REF_KPI_Norms (official formulas)
  busyRate: number | null; // N01: planned / available
  utilization: number | null; // N02: logged / available
  billableRate?: number | null; // N03: billable / logged
  benchRate?: number | null; // N04: bench / available
  overtimeRatio?: number | null; // N05: overtime / standard
  effortConsumption: number | null; // N06: logged / planned
  ragColor: RagColor;
  issueType: IssueType;
}

export interface ExcludedWeek {
  weekId: string;
  reason: SuppressionReason;
}

/**
 * Member-level finding (Answer_Key grain: entity = Member). Genuine issues only;
 * valid edge cases are represented by their absence plus `excludedWeeks`, which
 * record which weeks were neutralised and why (transparency / audit).
 */
export interface Finding {
  memberId: string;
  issueType: IssueType;
  ragColor: RagColor;
  busyRate: number | null;
  effortConsumption: number | null;
  detail: string;
  excludedWeeks: ExcludedWeek[];
}
