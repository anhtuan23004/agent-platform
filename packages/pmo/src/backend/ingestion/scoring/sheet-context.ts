import type { CanonicalField } from '../canonical-schema.ts';
import type { SheetRoleCandidate } from '../detect-sheet-role.ts';

// ── Compatibility matrix ─────────────────────────────────────────────────────
// Maps (sheetRole, fieldName) → compatibility factor (0–1).
// Fields that "belong" to their sheet's role get 1.0.
// Fields that can appear but don't define the sheet get moderate values.
// Fields clearly from another domain get low values.

const FIELD_ROLE_COMPATIBILITY: Record<string, Record<string, number>> = {
  resource_allocation: {
    member_id: 1.0,
    project_id: 1.0,
    allocation_pct: 1.0,
    start_date: 0.9,
    end_date: 0.9,
    weekly_planned_hours: 1.0,
    role: 0.8,
    // Fields from other tables appearing here get low scores
    logged_hours: 0.2,
    work_date: 0.3,
    leave_date: 0.1,
    leave_type: 0.1,
  },
  timesheet: {
    member_id: 1.0,
    project_id: 0.9,
    work_date: 1.0,
    logged_hours: 1.0,
    log_category: 1.0,
    task_ref: 1.0,
    // Fields from other tables
    allocation_pct: 0.2,
    start_date: 0.3,
    end_date: 0.3,
    leave_type: 0.1,
  },
  leave: {
    member_id: 0.9,
    record_id: 1.0,
    leave_date: 1.0,
    leave_type: 1.0,
    approved: 1.0,
    duration_days: 1.0,
    note: 0.8,
    // Fields from other tables
    allocation_pct: 0.1,
    logged_hours: 0.1,
    project_id: 0.3,
  },
  overbook_idle_config: {
    config_id: 1.0,
    rule_name: 1.0,
    overbook_threshold: 1.0,
    overbook_red_threshold: 1.0,
    idle_threshold: 1.0,
    mismatch_pct_threshold: 1.0,
    ot_max_hours_per_week: 1.0,
    effective_date: 0.9,
    member_id: 0.1,
    project_id: 0.1,
  },
  project_master: {
    project_id: 1.0,
    project_name: 1.0,
    account_id: 1.0,
    project_type: 1.0,
    status: 0.9,
    pm_id: 1.0,
    start_date: 0.8,
    end_date: 0.8,
    member_id: 0.3,
    allocation_pct: 0.1,
  },
  member_master: {
    member_id: 1.0,
    full_name: 1.0,
    department: 1.0,
    role_title: 1.0,
    level: 1.0,
    line_manager_id: 1.0,
    employment_status: 1.0,
    employment: 1.0,
    std_hours_week: 1.0,
    join_date: 0.9,
    project_id: 0.2,
    allocation_pct: 0.1,
  },
  calendar_weeks: {
    week_id: 1.0,
    week_start: 1.0,
    week_end: 1.0,
    working_days: 1.0,
    holiday_hours_ft: 1.0,
    note: 0.8,
    member_id: 0.1,
    project_id: 0.1,
  },
  kpi_norms: {
    norm_id: 1.0,
    metric: 1.0,
    formula: 1.0,
    green: 1.0,
    yellow: 1.0,
    red: 1.0,
    used_for: 1.0,
    member_id: 0.1,
    project_id: 0.1,
  },
};

// Default compatibility when field is not explicitly listed for a role
const DEFAULT_COMPATIBILITY = 0.5;

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreSheetContext(
  sheetRole: SheetRoleCandidate,
  canonicalField: CanonicalField,
): number {
  const roleMatrix = FIELD_ROLE_COMPATIBILITY[sheetRole.candidateRole];
  const fieldCompatibility = roleMatrix?.[canonicalField.name] ?? DEFAULT_COMPATIBILITY;

  // Final score = sheet role confidence × field compatibility
  return Math.round(sheetRole.confidence * fieldCompatibility * 100) / 100;
}
