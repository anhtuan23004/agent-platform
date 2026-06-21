// ── PMO_02 Analytics — shared types ──────────────────────────────────────────
// Pure analytics layer: member × week utilization facts, RAG classification,
// and edge-case suppression. No DB access here — see persist-facts.ts.

export type ScopeStatus = 'IN_SCOPE' | 'PRE_HIRE';

export type RagColor = 'green' | 'yellow' | 'red' | 'none';

export type IssueType = 'overbook' | 'idle' | 'mismatch_under' | 'mismatch_over' | 'ok';

export type SuppressionReason =
  | 'pre_hire'
  | 'holiday_week'
  | 'approved_leave'
  | 'approved_ot'
  | 'training';

// ── Source row shapes (subset of canonical tables this layer reads) ──────────

export interface MemberRow {
  member_id: string;
  full_name: string;
  role_title?: string | null;
  std_hours_week: number | null;
  join_date: Date | null;
}

export interface ProjectRow {
  project_id: string;
  project_name: string;
  account_id: string | null;
  project_type: string | null;
  status: string | null;
  pm_id: string | null;
  start_date: Date | null;
  end_date: Date | null;
}

export interface AllocationRow {
  member_id: string;
  project_id: string;
  role?: string | null;
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
  overbookRedThreshold: number; // busy >= this → overbook (red)
  idleThreshold: number; // busy < this → idle (red)
  idleYellowThreshold: number; // busy < this and >= idleThreshold → idle (yellow)
  mismatchPctThreshold: number; // |ec - 1| > this → mismatch
  otMaxHoursPerWeek: number;
  requiredTrainingHours: number; // N12 denominator (0 = not tracked)
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  overbookThreshold: 1.1,
  overbookRedThreshold: 1.2,
  idleThreshold: 0.75,
  idleYellowThreshold: 0.85,
  mismatchPctThreshold: 0.2,
  otMaxHoursPerWeek: 48,
  requiredTrainingHours: 0,
};

// ── Stable non-rebalance action codes ────────────────────────────────────────
// Phase 8: deterministic action codes with template text. LLM never invents or
// modifies these; they work fully without LLM. Rebalance actions live in the
// recommendation engine (Phase 2.5) and are not repeated here.

export const PMO_ACTION_CODES = {
  REBALANCE_ALLOCATION: 'REBALANCE_ALLOCATION',
  REVIEW_WITH_LINE_MANAGER: 'REVIEW_WITH_LINE_MANAGER',
  CHECK_MISSING_TIMESHEET: 'CHECK_MISSING_TIMESHEET',
  CONFIRM_APPROVED_OT: 'CONFIRM_APPROVED_OT',
  VALIDATE_TRAINING_TIME: 'VALIDATE_TRAINING_TIME',
  REVIEW_RA_TIMESHEET_MISMATCH: 'REVIEW_RA_TIMESHEET_MISMATCH',
  NO_ACTION: 'NO_ACTION',
} as const;

export type PmoActionCode = (typeof PMO_ACTION_CODES)[keyof typeof PMO_ACTION_CODES];

/**
 * Deterministic template text for each action code. Sufficient when LLM is
 * unavailable. Each template is a concise instruction suitable for report
 * display without further context.
 */
export const PMO_ACTION_TEMPLATES: Record<PmoActionCode, string> = {
  REBALANCE_ALLOCATION:
    'Review workload allocation with project leads and consider redistributing hours to under-utilised team members.',
  REVIEW_WITH_LINE_MANAGER:
    'Discuss allocation gap with line manager. Confirm whether member is available for additional project assignments.',
  CHECK_MISSING_TIMESHEET:
    'Logged hours are significantly below planned hours. Verify timesheet completeness and follow up with the member.',
  CONFIRM_APPROVED_OT:
    'Overtime hours detected in the reporting period. Confirm that overtime was pre-approved and within policy limits.',
  VALIDATE_TRAINING_TIME:
    'Training hours recorded during the reporting period. Validate training attendance and ensure it is reflected in the capacity plan.',
  REVIEW_RA_TIMESHEET_MISMATCH:
    'Logged hours exceed planned hours. Review resource allocation accuracy and confirm whether additional effort was authorised.',
  NO_ACTION: 'No action required at this time.',
};

export interface SuggestedAction {
  actionCode: PmoActionCode;
  templateText: string;
  /** Primary action is the first in the list and drives the finding's main suggestedActionCode. */
  primary: boolean;
}

// ── Derived facts and findings ───────────────────────────────────────────────

export interface MemberWeekFact {
  memberId: string;
  weekId: string;
  scopeStatus: ScopeStatus;
  availableHours: number;
  plannedHours: number;
  loggedHours: number;
  expectedLoggedHours: number;
  billableHours: number;
  benchHours: number;
  overtimeHours: number;
  trainingHours: number;
  // Metrics per REF_KPI_Norms (official formulas)
  busyRate: number | null; // N01: planned / available
  utilization: number | null; // N02: logged / available
  billableRate: number | null; // N03: billable / logged
  benchRate: number | null; // N04: bench / available
  overtimeRatio: number | null; // N05: overtime / standard
  effortConsumption: number | null; // N06: logged / planned
  trainingCompliance: number | null; // N12: training / required
  ragColor: RagColor;
  issueType: IssueType;
}

export interface ExcludedWeek {
  weekId: string;
  reason: SuppressionReason;
}

export interface ContextAnnotation {
  weekId: string;
  reason: 'approved_ot' | 'training';
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
  annotations: ContextAnnotation[];
  reviewRequired: boolean;
  /** Primary action code (backward-compatible scalar). */
  suggestedActionCode: PmoActionCode;
  /** All applicable actions with deterministic template text (Phase 8). */
  suggestedActions: SuggestedAction[];
}
