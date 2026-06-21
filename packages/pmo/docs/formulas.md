# PMO analytics formulas (reference)

This document is a **single-source cheat sheet** of the PMO utilization formulas and how this codebase computes them.

Scope:
- **Per-week metrics**: computed at the grain **member x week** (aka "facts").
- **Member-level aggregation**: computed from the facts for finding detection.
- **Exclude rules**: which weeks are suppressed from member-level aggregation (and why).
- **Action codes**: deterministic suggested actions per finding.

Code references:
- Facts builder: `packages/pmo/src/backend/analytics/member-week-facts.ts`
- Per-week formulas: `packages/pmo/src/backend/analytics/metrics.ts`
- Inputs (planned/logged/billable/training): `packages/pmo/src/backend/analytics/planned-hours.ts`
- Availability + OT hours: `packages/pmo/src/backend/analytics/available-hours.ts`
- Member-level aggregation + exclude: `packages/pmo/src/backend/analytics/findings.ts`
- Rule catalog: `config/pmo-report-rules/default.v1.json`
- Rule resolver: `packages/pmo/src/backend/reporting/rules/resolve.ts`
- Action codes + templates: `packages/pmo/src/backend/analytics/types.ts` (`PMO_ACTION_CODES`, `PMO_ACTION_TEMPLATES`)
- Legacy threshold resolution: `packages/pmo/src/backend/analytics/thresholds.ts`
- Week classification (RAG/IssueType at week grain): `packages/pmo/src/backend/analytics/classify.ts`

---

## Definitions

- **Available hours**: capacity for that member in that week (after working days + approved absence).
- **Planned hours**: weekly planned hours from resource allocations active in that week.
- **Logged hours**: sum of timesheet logged hours for dates inside the week.
- **Std hours / week**: member standard weekly hours (full-time typically 40; part-time e.g. 20).

Notation used below:
- \(A\) = availableHours
- \(P\) = plannedHours
- \(L\) = loggedHours
- \(B\) = billableHours
- \(T\) = trainingHours
- \(OT\) = approved overtime hours
- \(S\) = stdHoursWeek

---

## Stage 0 — Canonical inputs (what the analytics reads)

The report engine loads *published canonical rows* from Postgres `pmo.*` where `is_active=true`:
- `pmo.member_master` -> member id, std hours/week, join date
- `pmo.resource_allocations` -> planned hours
- `pmo.timesheets` -> logged hours + log category
- `pmo.leave_records` -> approved leave / approved OT comp / training (depending on type)
- `pmo.calendar_weeks` -> week windows + working days + holiday hours

Thresholds come from the versioned rule catalog at `config/pmo-report-rules/default.v1.json`, resolved via `resolveReportRules()`. Legacy `pmo.overbook_idle_config` is kept for compatibility; mismatches are logged via `auditLegacyRuleCompatibility()`.

---

## Stage 1 — Member x week facts (per-week metrics)

### 1) Available hours

**Base capacity** is scaled by working days:

\[
A = S \times \frac{workingDays}{5} - leaveHours
\]

- `workingDays` comes from `calendar_weeks.working_days` (holiday week reduces workingDays).
- `leaveHours` is **approved, member-specific absence leave types** only.
- \(A\) is clamped to **not negative**.

Notes:
- Company-wide holidays have `member_id = null` in leave records and are **NOT** subtracted here (already represented by `working_days`).
- Leave types that *do not reduce availability*:
  - `Approved OT Comp` (represents sanctioned extra work)
  - `Training` (counted separately; member is still "present")

### 2) Planned hours

\[
P = \sum weeklyPlannedHours
\]

Only allocations that are **active in the week** are included.

### 3) Logged hours

\[
L = \sum loggedHours
\]

All timesheet rows whose `work_date` is inside the week contribute.

### 4) Expected logged hours (helper, not used for mismatch)

\[
expectedLogged = P \times \frac{A}{S}
\]

Used as an informational signal; mismatch detection uses **EC** below.

### 5) Billable hours

\[
B = \sum loggedHours \quad \text{where } logCategory = "project"
\]

Category match is case-insensitive on `'project'`.

### 6) Training hours

\[
T = \sum loggedHours \quad \text{where } logCategory = "training"
\]

Category match is case-insensitive on `'training'`.

### 7) Bench hours

\[
benchHours = \max(0, A - P)
\]

### 8) Approved overtime hours

\[
OT = \sum durationDays \times \frac{S}{5}
\]

Only from **approved** leave records with `leave_type = "Approved OT Comp"` inside the week.

---

## Normalized KPI formulas (week grain)

These are the "Nxx" ratios stored on each member x week fact.

### N01 Busy rate

\[
busyRate = \frac{P}{A}
\]

If \(A=0\) -> `null`.

### N02 Utilization

\[
utilization = \frac{L}{A}
\]

If \(A=0\) -> `null`.

### N03 Billable rate

\[
billableRate = \frac{B}{L}
\]

If \(L=0\) -> `null`.

### N04 Bench rate

\[
benchRate = \frac{\max(0, A - P)}{A}
\]

If \(A=0\) -> `null`.

### N05 Overtime ratio

\[
overtimeRatio = \frac{OT}{S}
\]

If \(S=0\) -> `null`.

### N06 Effort Consumption (EC)

\[
EC_{week} = \frac{L}{P}
\]

If \(P=0\) -> `null`.

Interpretation:
- **EC = 1.0**: logged equals plan
- **EC > 1.0**: overlog
- **EC < 1.0**: underlog

### N12 Training compliance (optional)

If `requiredTrainingHours > 0`:

\[
trainingCompliance = \min\left(\frac{T}{requiredTrainingHours}, 1\right)
\]

Else -> `null`.

---

## Stage 2 — Member-level aggregation (from week facts)

Facts are grouped by member. Pre-hire weeks are labeled `PRE_HIRE` and are not considered in the in-scope set.

### Excluded weeks (suppression)

Some weeks are **excluded from member-level aggregation** because they have zero available capacity:
- **holiday_week**: the calendar week has `holiday_hours_ft > 0` and `availableHours = 0`
- **approved_leave**: `availableHours = 0` (full leave week)

These suppressed weeks are removed from aggregation sums.

**NOT exclusions** (weeks stay in scope with annotations):
- **approved_ot**: Approved OT is an annotation/supporting context; the week keeps its metrics.
- **training**: Training is an annotation/supporting context; the week stays in scope.

### Member busy rate (used for overbook/idle findings)

**Ratio-of-sums** aggregation (not mean of weekly ratios):

\[
busy_{member} = \frac{\sum P}{\sum A} \quad \text{over remaining in-scope, non-suppressed weeks}
\]

If no weeks remain or member has zero plan and zero log across the window -> `null`.

### Member Effort Consumption (EC) (used for mismatch findings)

\[
EC_{member} = \frac{\sum L}{\sum P} \quad \text{over remaining in-scope, non-suppressed weeks}
\]

If \(\sum P = 0\) -> `null`.

---

## Stage 3 — Findings (member-level detectors)

### Overbook / idle (capacity-driven)

Using \(busy_{member}\) and locked boundary thresholds from the rule catalog:
- **Overbook (red)** if \(busy_{member} \geq 1.20\)
- **Overbook (yellow)** if \(busy_{member} > 1.10\)
- **Idle (red)** if \(busy_{member} < 0.75\)
- **Idle (yellow)** if \(busy_{member} \geq 0.75\) and \(busy_{member} < 0.85\)
- **Healthy (green)** if \(0.85 \leq busy_{member} \leq 1.10\)

The `detail` string shown in the UI is generated here (e.g. "Busy 115% - overbooked, rebalance").

### Mismatch (logged vs planned)

Using \(EC_{member}\):

\[
drift = |EC_{member} - 1|
\]

If \(drift > mismatchPctThreshold\) (default 0.20):
- `mismatch_under` when \(EC_{member} < 1\)
- `mismatch_over` when \(EC_{member} > 1\)

The `detail` string explains the mismatch direction.

---

## Stage 4 — Action codes

Each finding carries a typed `suggestedActionCode` (primary) and a `suggestedActions` array with deterministic template text. No LLM is involved.

### Primary action codes (from issue type)

| Issue type | Action code | Template |
|---|---|---|
| `overbook` | `REBALANCE_ALLOCATION` | Review workload allocation with project leads and consider redistributing hours. |
| `idle` | `REVIEW_WITH_LINE_MANAGER` | Discuss allocation gap with line manager. |
| `mismatch_under` | `CHECK_MISSING_TIMESHEET` | Logged hours significantly below planned; verify timesheet completeness. |
| `mismatch_over` | `REVIEW_RA_TIMESHEET_MISMATCH` | Logged hours exceed planned; review RA accuracy. |

### Annotation-driven secondary actions

| Annotation | Action code | Template |
|---|---|---|
| `approved_ot` | `CONFIRM_APPROVED_OT` | Confirm overtime was pre-approved and within policy limits. |
| `training` | `VALIDATE_TRAINING_TIME` | Validate training attendance and ensure capacity plan reflects it. |

These are appended to the finding's `suggestedActions` array with `primary: false`.

---

## Stage 5 — Answer Key validation (demo only)

The demo page compares:
- expected outcomes (PMO_02 Answer Key)
- vs actual findings produced by the detectors above

For valid edge cases (e.g. excluded weeks), the correct result is **no finding** and the explanation comes from `excludedWeeks`.
