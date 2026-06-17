# PMO analytics formulas (reference)

This document is a **single-source cheat sheet** of the PMO utilization formulas and how this codebase computes them.

Scope:
- **Per-week metrics**: computed at the grain **member × week** (aka “facts”).
- **Member-level aggregation**: computed from the facts for finding detection.
- **Exclude rules**: which weeks are suppressed from member-level aggregation (and why).

Code references:
- Facts builder: `packages/pmo/src/backend/analytics/member-week-facts.ts`
- Per-week formulas: `packages/pmo/src/backend/analytics/metrics.ts`
- Inputs (planned/logged/billable/training): `packages/pmo/src/backend/analytics/planned-hours.ts`
- Availability + OT hours: `packages/pmo/src/backend/analytics/available-hours.ts`
- Member-level aggregation + exclude: `packages/pmo/src/backend/analytics/findings.ts`
- Threshold resolution: `packages/pmo/src/backend/analytics/thresholds.ts`
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

The demo page loads *published canonical rows* from Postgres `pmo.*` where `is_active=true`:
- `pmo.member_master` → member id, std hours/week, join date
- `pmo.resource_allocations` → planned hours
- `pmo.timesheets` → logged hours + log category
- `pmo.leave_records` → approved leave / approved OT comp / training (depending on type)
- `pmo.calendar_weeks` → week windows + working days + holiday hours
- `pmo.overbook_idle_config` → thresholds

---

## Stage 1 — Member × week facts (per-week metrics)

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
  - `Training` (counted separately; member is still “present”)

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
B = \sum loggedHours \quad \text{where } logCategory = \"project\"
\]

Category match is case-insensitive on `'project'`.

### 6) Training hours

\[
T = \sum loggedHours \quad \text{where } logCategory = \"training\"
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

Only from **approved** leave records with `leave_type = \"Approved OT Comp\"` inside the week.

---

## Normalized KPI formulas (week grain)

These are the “Nxx” ratios stored on each member×week fact.

### N01 Busy rate

\[
busyRate = \frac{P}{A}
\]

If \(A=0\) → `null`.

### N02 Utilization

\[
utilization = \frac{L}{A}
\]

If \(A=0\) → `null`.

### N03 Billable rate

\[
billableRate = \frac{B}{L}
\]

If \(L=0\) → `null`.

### N04 Bench rate

\[
benchRate = \frac{\max(0, A - P)}{A}
\]

If \(A=0\) → `null`.

### N05 Overtime ratio

\[
overtimeRatio = \frac{OT}{S}
\]

If \(S=0\) → `null`.

### N06 Effort Consumption (EC)

\[
EC_{week} = \frac{L}{P}
\]

If \(P=0\) → `null`.

Interpretation:
- **EC = 1.0**: logged equals plan
- **EC > 1.0**: overlog
- **EC < 1.0**: underlog

### N12 Training compliance (optional)

If `requiredTrainingHours > 0`:

\[
trainingCompliance = \min\left(\frac{T}{requiredTrainingHours}, 1\right)
\]

Else → `null`.

---

## Stage 2 — Member-level aggregation (from week facts)

Facts are grouped by member. Pre-hire weeks are labeled `PRE_HIRE` and are not considered in the in-scope set.

### Excluded weeks (suppression)

Some weeks are **excluded from member-level aggregation** because they structurally distort ratios:
- **holiday_week**: the calendar week has `holiday_hours_ft > 0`
- **approved_leave**: availableHours is 0 (full leave week)
- **approved_ot**: the member has approved `Approved OT Comp` inside the week
- **training**: the member has approved `Training` inside the week

These exclusions apply to **both** busy rate aggregation and effort-consumption aggregation.

### Member busy rate (used for overbook/idle findings)

\[
busy_{member} = mean(busyRate_{week}) \quad \text{over remaining in-scope, non-excluded weeks}
\]

If no weeks remain → `null`.

### Member Effort Consumption (EC) (used for mismatch findings)

\[
EC_{member} = \frac{\sum L}{\sum P} \quad \text{over remaining in-scope, non-excluded weeks}
\]

If \(\sum P = 0\) → `null`.

---

## Stage 3 — Findings (member-level detectors)

Thresholds are resolved from `pmo.overbook_idle_config` (latest `effective_date`), with per-field fallback to defaults.

### Overbook / idle (capacity-driven)

Using \(busy_{member}\):
- **Overbook (yellow)** if \(busy_{member} > overbookThreshold\)
- **Overbook (red)** if \(busy_{member} > overbookRedThreshold\)
- **Idle (red)** if \(busy_{member} < idleThreshold\)

The `detail` string shown in the UI is generated here (e.g. “Busy 115% — overbooked, rebalance”).

### Mismatch (logged vs planned)

Using \(EC_{member}\):

\[
drift = |EC_{member} - 1|
\]

If \(drift > mismatchPctThreshold\):
- `mismatch_under` when \(EC_{member} < 1\)
- `mismatch_over` when \(EC_{member} > 1\)

The `detail` string explains the mismatch direction.

---

## Stage 4 — Answer Key validation (demo only)

The demo page compares:
- expected outcomes (PMO_02 Answer Key)
- vs actual findings produced by the detectors above

For valid edge cases (e.g. excluded weeks), the correct result is **no finding** and the explanation comes from `excludedWeeks`.
