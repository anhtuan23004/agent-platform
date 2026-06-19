# PMO Report Engine — Problem 2: Idle / Overbook / Workload Health

Implementation plan for the deterministic analytics layer powering Problem 2 reports.
Report Agent = orchestration + narrative; Report Engine = deterministic analytics.
LLM never computes utilization, classifies idle/overbook, or infers missing data.

---

## Design Principles

1. **N01 Busy Rate decides idle/overbook.** N02–N06 explain cause and risk level.
2. **Agent reads engine output to write narrative.** Agent must not re-apply rules.
3. **Thresholds come from tenant config, not code constants.** Report output includes which config version was used for auditability.
4. **OT and training are context annotations, not exclusions.** Only `holiday_week` and `approved_leave` (available=0) suppress a week from member-level aggregation. OT/training weeks stay in classification so overload is not hidden.
5. **Supporting signals do not override primary classification.** Signals are diagnostic evidence attached to findings.

---

## Current State (What Already Exists)

| Feature | Status | Location |
|---------|--------|----------|
| `ingestionSessionId` on `pmo_generateReport` | Done | `agent-tools/generate-report.ts:33`, `report.ts:17` |
| `loadCanonicalInputs` filters by `ingestionSessionId` | Done | `load-canonical.ts:77-79` |
| Threshold resolution by `effective_date` | Done | `thresholds.ts:23-44` |
| `overbook_idle_config` DB table | Done | `schema.ts:226-254` |
| `kpi_norms` DB table | Done | `schema.ts:283-309` |
| N01–N06, N12 metric formulas | Done | `metrics.ts:53-99` |
| Member-week fact grid with PRE_HIRE scoping | Done | `member-week-facts.ts:42-132` |
| Report persistence in `report_runs` with `ingestion_session_id` | Done | `handlers/generate-report.ts:195-223` |
| `overbook-idle-defaults.json` with versioned configs | Done | `config/overbook-idle-defaults.json` |

---

## Gap Analysis

### Gap 1 — Classification taxonomy too narrow

Current `classify.ts` only distinguishes:

```
planned=0 && logged=0 → ragColor:'none', issueType:'ok'   // should be 'no_plan'
busyRate > 1.2        → red / overbook
busyRate > 1.1        → yellow / overbook
busyRate < 0.75       → red / idle
else                  → green / ok
```

Missing: `no_plan`, `unplanned_work`, `planned_future`, `timesheet_pending`, `planned_no_actual`, `idle_yellow` (75–84%), `excluded`.

### Gap 2 — No supporting signals

Metrics N02–N06 are computed and persisted but never interpreted as diagnostic signals (`burnout_risk`, `low_billable`, `high_bench`, `high_overtime`, `ra_timesheet_mismatch_*`).

### Gap 3 — OT/training fully excluded from member-level aggregation

`findings.ts:72-73` excludes `approved_ot` and `training` weeks entirely from busy rate averaging. This hides genuine overload backed by approved OT and idle caused by training.

### Gap 4 — Threshold version not in report output

`generatePmoReport()` resolves thresholds but does not return which config produced the result. Reports from different config versions are indistinguishable.

### Gap 5 — No `idleYellowThreshold` in config

`Thresholds` type has `idleThreshold: 0.75` but no boundary between `idle_yellow` and `normal` (0.85). Requires a new DB column + migration.

---

## Classification Taxonomy (Full)

### Per-week classification (N01 primary)

Order of evaluation — first match wins:

| # | Condition | `issueType` | `ragColor` |
|---|-----------|-------------|------------|
| 1 | `available_h == 0` | `excluded` | `none` |
| 2 | `planned == 0 && logged == 0` | `no_plan` | `none` |
| 3 | `planned == 0 && logged > 0` | `unplanned_work` | `yellow` |
| 4a | `planned > 0 && logged == 0 && week_end > now` | `planned_future` | `gray` |
| 4b | `planned > 0 && logged == 0 && now - week_end <= submitDeadlineDays` | `timesheet_pending` | `gray` |
| 4c | `planned > 0 && logged == 0 && past deadline` | `planned_no_actual` | `yellow` |
| 5 | `busyRate >= 1.20` | `overbook` | `red` |
| 6 | `busyRate > 1.10` | `overbook` | `yellow` |
| 7 | `busyRate < 0.75` | `idle` | `red` |
| 8 | `busyRate < 0.85` | `idle` | `yellow` |
| 9 | EC mismatch (existing) | `mismatch_under` / `mismatch_over` | `red` |
| 10 | otherwise | `ok` | `green` |

### Member-level escalation

At finding aggregation, `planned_no_actual` escalates from `yellow` to `red` when a member has 3+ consecutive or 4+ total `planned_no_actual` weeks.

### Exclusion vs. annotation

| Condition | Effect |
|-----------|--------|
| `holiday_week` (holiday_hours_ft > 0) | **Excluded** from member-level aggregation |
| `approved_leave` (available_h = 0) | **Excluded** from member-level aggregation |
| `approved_ot` | **Annotated** — stays in classification, attached as `ContextAnnotation` |
| `training` | **Annotated** — stays in classification, attached as `ContextAnnotation` |

---

## Supporting Signals (N02–N06)

Signals attach to findings as diagnostic evidence. They do not override the primary N01 classification.

| Signal | Metric | Condition | Level |
|--------|--------|-----------|-------|
| `burnout_risk` | N02 Utilization | > 1.00 | red |
| `low_billable` | N03 Billable Rate | < 0.70 | red |
| `high_bench` | N04 Bench Rate | > 0.20 | red |
| `high_overtime` | N05 Overtime Ratio | > 0.15 | red |
| `ra_timesheet_mismatch` | N06 Effort Consumption | >= 1.20 or <= 0.75 | red |
| `ra_timesheet_mismatch` | N06 Effort Consumption | >= 1.11 or <= 0.84 | yellow |

Signal thresholds are stored in a separate `pmo.signal_thresholds` table (admin-configurable, not workbook-ingested).

---

## Threshold Config

### Runtime threshold config (`overbook_idle_config`)

```ts
interface Thresholds {
  overbookThreshold: number;           // 1.10 — busy > this → overbook yellow
  overbookRedThreshold: number;        // 1.20 — busy > this → overbook red
  idleThreshold: number;               // 0.75 — busy < this → idle red
  idleYellowThreshold: number;         // 0.85 — busy < this → idle yellow (NEW)
  mismatchPctThreshold: number;        // 0.20
  otMaxHoursPerWeek: number;           // 48
  requiredTrainingHours: number;       // 0
  timesheetSubmitDeadlineDays: number;  // 3 business days (NEW)
}
```

### Threshold version (audit trail)

Every report output includes:

```ts
interface ThresholdVersion {
  configId: string | null;
  ruleName: string | null;
  effectiveDate: string | null;
}
```

So if PMO changes thresholds from 75% to 80%, old reports remain explainable.

---

## Report Engine Flow

```
load config by effective_date
  → resolve thresholds + threshold version
  → load signal_thresholds for tenant
  → load canonical data (filtered by ingestionSessionId if provided)
→ compute member-week facts
  → compute metrics N01, N02, N03, N04, N05, N06, N12
  → classify per-week (10-branch taxonomy with temporal logic)
  → compute per-week supporting signals
→ member-level aggregation
  → exclude holiday + full-leave weeks
  → annotate OT + training weeks (not excluded)
  → compute member busy rate (mean of non-excluded weeks)
  → compute member EC (sum logged / sum planned of non-excluded weeks)
→ detect findings
  → overbook/idle by member busy rate
  → mismatch by member EC
  → planned_no_actual escalation (yellow → red for repeating)
  → attach supporting signals to each finding
  → attach context annotations to each finding
→ aggregate summary
→ return compact findings + threshold version to Agent
```

---

## Agent State Flow

```
report_requested
→ awaiting_report_range
→ generating_report         (Report Engine runs internally)
→ generating_narrative      (Agent writes from engine output)
→ report_ready
→ optional: awaiting_save_approval
→ saved
```

Internal engine states (`querying_data`, `computing_facts`, `classifying`, `aggregating`) are progress indicators for the UI, not LangGraph states.

---

## Report Output Shape

```ts
interface GeneratePmoReportOutput {
  dateRange: PmoReportDateRange;
  thresholdVersion: ThresholdVersion;
  thresholds: Thresholds;
  summary: {
    memberCount: number;
    overbookCount: number;
    idleCount: number;
    noPlanCount: number;
    unplannedWorkCount: number;
    plannedNoActualCount: number;
    excludedWeekCount: number;
  };
  findings: Array<{
    memberId: string;
    issueType: IssueType;
    ragColor: RagColor;
    busyRate: number | null;
    effortConsumption: number | null;
    detail: string;
    excludedWeeks: Array<{ weekId: string; reason: string }>;
    annotations: ContextAnnotation[];
    signals: SupportingSignal[];
  }>;
}
```

`pmo_generateReport` returns the summary + compact findings. `pmo_getFindingDetails` (future) is only called when the user asks for drill-down on specific members.

---

## Implementation Phases

### Phase 1 — Expand type definitions

**File:** `packages/pmo/src/backend/analytics/types.ts`

- Expand `RagColor`: add `'gray'`
- Expand `IssueType`: add `'excluded'`, `'no_plan'`, `'unplanned_work'`, `'planned_future'`, `'timesheet_pending'`, `'planned_no_actual'`
- Add `SupportingSignal` type (6 values)
- Add `ContextAnnotation` interface (`weekId`, `type: 'approved_ot' | 'training'`)
- Add `ThresholdVersion` interface (`configId`, `ruleName`, `effectiveDate`)
- Expand `Thresholds`: add `idleYellowThreshold` (default 0.85), `timesheetSubmitDeadlineDays` (default 3)
- Expand `Finding`: add `annotations: ContextAnnotation[]`, `signals: SupportingSignal[]`

### Phase 2a — DB: `overbook_idle_config` new columns

**File:** `packages/pmo/src/backend/db/schema.ts`

Add to `overbookIdleConfig`:

```ts
idle_yellow_threshold: real('idle_yellow_threshold'),
timesheet_submit_deadline_days: integer('timesheet_submit_deadline_days'),
```

Run: `pnpm --filter @seta/pmo db:generate && pnpm db:migrate`

### Phase 2b — DB: New `pmo.signal_thresholds` table

**File:** `packages/pmo/src/backend/db/schema.ts`

Admin-configurable table (no `natural_key_hash` / ingestion pattern):

```ts
export const signalThresholds = pmoSchema.table('signal_thresholds', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  signal_name: text('signal_name').notNull(),
  metric_name: text('metric_name').notNull(),
  operator: text('operator').notNull(),       // 'gt', 'lt', 'gte', 'lte'
  threshold_value: real('threshold_value').notNull(),
  signal_level: text('signal_level').notNull(), // 'yellow', 'red'
  is_active: boolean('is_active').notNull().default(true),
  effective_date: timestamp('effective_date', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('signal_thresholds_tenant_signal').on(t.tenant_id, t.signal_name, t.signal_level),
  index('signal_thresholds_tenant_active').on(t.tenant_id, t.is_active),
]);
```

Register in `packages/pmo/src/register.ts`. Generate migration.

Default seed data (8 rows):

| signal_name | metric_name | operator | threshold_value | signal_level |
|---|---|---|---|---|
| `burnout_risk` | `utilization` | `gt` | 1.00 | `red` |
| `low_billable` | `billable_rate` | `lt` | 0.70 | `red` |
| `high_bench` | `bench_rate` | `gt` | 0.20 | `red` |
| `high_overtime` | `overtime_ratio` | `gt` | 0.15 | `red` |
| `ra_timesheet_mismatch` | `effort_consumption` | `gte` | 1.20 | `red` |
| `ra_timesheet_mismatch` | `effort_consumption` | `lte` | 0.75 | `red` |
| `ra_timesheet_mismatch` | `effort_consumption` | `gte` | 1.11 | `yellow` |
| `ra_timesheet_mismatch` | `effort_consumption` | `lte` | 0.84 | `yellow` |

### Phase 2c — Threshold resolution

**File:** `packages/pmo/src/backend/analytics/thresholds.ts`

- Add `idleYellowThreshold` and `timesheetSubmitDeadlineDays` resolution from config row
- Change `resolveThresholds()` to return `ResolvedThresholds`:

```ts
interface ResolvedThresholds {
  thresholds: Thresholds;
  version: ThresholdVersion;
}
```

**File:** `packages/pmo/src/backend/analytics/load-canonical.ts`

- Add `loadSignalThresholds(tenantId)` query against `signal_thresholds` table
- Include signal threshold rows in `CanonicalInputs`

### Phase 2d — Update defaults config

**File:** `packages/pmo/config/overbook-idle-defaults.json`

Add to both config entries:

```json
"idle_yellow_threshold": 0.85,
"timesheet_submit_deadline_days": 3
```

### Phase 3 — Rewrite classification

**File:** `packages/pmo/src/backend/analytics/classify.ts`

New `classifyRag()` accepts temporal context:

```ts
interface ClassifyContext {
  metrics: WeekMetrics;
  thresholds: Thresholds;
  weekEnd: Date;
  now: Date;
}
```

Full 10-branch taxonomy as specified above. See "Classification Taxonomy" section.

Add `computeSupportingSignals()`:

```ts
function computeSupportingSignals(
  metrics: WeekMetrics,
  signalConfig: SignalThresholdRow[],
): SupportingSignal[]
```

Reads signal thresholds from DB rows, applies operator + threshold_value against the matching metric.

### Phase 4 — Update findings

**File:** `packages/pmo/src/backend/analytics/findings.ts`

- `weekSuppressionReason()`: remove `approved_ot` and `training` branches. Only `holiday_week` and `approved_leave` remain.
- Add `weekAnnotations()` function: returns `ContextAnnotation[]` for OT/training weeks.
- `analyzeMembers()`: collect annotations alongside exclusions. Include OT/training weeks in busy rate averaging.
- `detectOverbookIdle()`: attach signals (union of per-week signals) and annotations to each finding.
- Add `detectTimesheetGaps()`: at member level, escalate `planned_no_actual` from `yellow` to `red` when 3+ consecutive or 4+ total weeks.

### Phase 5 — Update report output

**File:** `packages/pmo/src/backend/analytics/report.ts`

- `generatePmoReport()` returns `thresholdVersion`, `thresholds`, expanded `summary` counts, and findings with `signals` + `annotations`.

**File:** `packages/pmo/src/backend/agent-tools/generate-report.ts`

- Update Zod output schema to include `thresholdVersion`, `thresholds`, `signals`, `annotations`, new summary fields.

### Phase 6 — Tests

| Test file | Scope |
|---|---|
| New: `tests/unit/analytics/classify.test.ts` | All 10 classification branches, temporal `planned_no_actual` variants, boundary conditions |
| New: `tests/unit/analytics/signals.test.ts` | Signal computation from metric values + signal config rows |
| Update: `tests/unit/analytics/member-week-facts.test.ts` | New issue types (`no_plan`, `excluded`, etc.), `gray` rag color |
| Update: `tests/unit/analytics/demo-analytics.test.ts` | Adjust for changed OT/training exclusion behavior |
| Update: `tests/unit/workflows/ingest-data-v2/generate-report.test.ts` | New report output shape with thresholdVersion, signals |
| Update: `tests/integration/compute-facts.test.ts` | New classification values persisted correctly |
| Update: `tests/integration/ensure-facts-computed.test.ts` | Updated expected values |

### Phase 7 — Documentation

**File:** `packages/pmo/docs/formulas.md`

Update with:

- Classification taxonomy table (10 issue types with ragColor mapping)
- Temporal `planned_no_actual` rules and escalation
- Supporting signals specification and thresholds
- Exclusion vs. annotation distinction
- Threshold version audit trail explanation

---

## Files Touched

| File | Action |
|---|---|
| `packages/pmo/src/backend/analytics/types.ts` | Expand enums, add types |
| `packages/pmo/src/backend/analytics/classify.ts` | Full rewrite |
| `packages/pmo/src/backend/analytics/findings.ts` | Modify exclusion, add annotations + signals |
| `packages/pmo/src/backend/analytics/thresholds.ts` | Add fields, return version |
| `packages/pmo/src/backend/analytics/metrics.ts` | Add signal computation (or new `signals.ts`) |
| `packages/pmo/src/backend/analytics/report.ts` | Expand output |
| `packages/pmo/src/backend/analytics/member-week-facts.ts` | Pass `now` and `weekEnd` to classify |
| `packages/pmo/src/backend/analytics/load-canonical.ts` | Load signal_thresholds |
| `packages/pmo/src/backend/db/schema.ts` | 2 columns on `overbook_idle_config` + new `signal_thresholds` table |
| `packages/pmo/src/backend/agent-tools/generate-report.ts` | Update output schema |
| `packages/pmo/config/overbook-idle-defaults.json` | Add new fields |
| `packages/pmo/src/register.ts` | Register new table |
| `packages/pmo/docs/formulas.md` | Full update |
| `drizzle/migrations/` | 2 generated migrations |
| ~6 test files | New + updated |

**Total: ~15 files modified, 2 new files (migrations), ~6 test files.**

---

## Metric Reference (Problem 2)

### Primary classification

| Metric | Formula | Role |
|---|---|---|
| N01 Busy Rate | `Planned_h / Available_h` | Idle / overbook — primary classifier |

### Supporting diagnosis

| Metric | Formula | Role |
|---|---|---|
| N02 Utilization Rate | `Worked_h / Available_h` | Real work intensity; > 100% burnout signal |
| N03 Billable Rate | `Billable_h / Worked_h` | Revenue-generating hours quality |
| N04 Bench Rate | `Bench_h / Available_h` | Unassigned capacity |
| N05 Overtime Ratio | `OT_h / Standard_h` | Leading burnout indicator |
| N06 Effort Consumption | `Actual_h / Planned_h` | RA vs Timesheet mismatch |
| N12 Training Compliance | `Done / Required` | Edge case explanation |

### Not used for Problem 2

N07 On-time Delivery, N08 SPI, N09 Velocity Variance, N10 THI, N11 Risk Closure Rate — these serve Problem 1 (feasibility).

### N01 Busy Rate bands (corrected)

```
< 75%      → idle red
75–84%     → idle yellow / underallocated
85–110%    → normal
111–119%   → overbook yellow
>= 120%    → overbook red
```

---

## Hour Computations (Reference)

```ts
Standard_h = Std_Hours_Week              // e.g. 40h/week
Holiday_h  = holiday_days * hours_per_day
Leave_h    = approved_leave_hours
Available_h = max(0, Standard_h * (working_days / 5) - Leave_h)

Planned_h =
  if RA has weekly_planned_hours: sum(weekly_planned_hours)
  if RA has allocation_pct: sum(allocation_pct * Available_h)

Worked_h     = sum(timesheet_hours)
Billable_h   = sum(timesheet_hours where log_category = 'project')
Training_h   = sum(timesheet_hours where log_category = 'training')
Bench_h      = max(0, Available_h - Planned_h)
OT_h         = max(0, Worked_h - Available_h)

safeDiv(a, b) = b > 0 ? a / b : null
```
