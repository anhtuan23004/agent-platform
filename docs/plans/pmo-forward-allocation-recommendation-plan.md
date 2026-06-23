# PMO Forward Allocation Recommendation Plan

Plan for a second PMO report/workflow focused on forward-looking allocation recommendations,
distinct from the existing workload health report (`overbook` / `idle` / `mismatch`).

This document is implementation-oriented. It answers three questions first:

1. What already exists in the PMO module and can be reused?
2. What is missing for a production-grade forward allocation report?
3. How should implementation be phased so the feature can ship incrementally without breaking the
   existing PMO report pipeline?

---

## Goal

Add a new PMO capability:

`RA Forward Allocation Recommendation`

The capability should analyze near-future allocation changes and produce deterministic staffing
recommendations for a planning horizon, typically the next 2 months.

The plan assumes one explicit business constraint:

- RA upload is history and supply-side evidence, not sufficient proof for an official future
  allocation proposal on its own.

This is not the same as the current workload-health report.

Current report answers:

- who is overbooked
- who is idle
- who has RA-vs-timesheet mismatch

New report should answer:

- which members are likely to become available soon
- which active projects still need capacity in the same horizon
- which member-to-project moves or extensions are reasonable
- which cases are demand-backed allocation proposals vs inferred directional suggestions

The distinction is mandatory:

- `demand_backed` -> may be treated as an allocation proposal candidate
- `inferred` -> planning support only

---

## Scope

### In scope

- A new PMO report family for forward allocation recommendation
- Deterministic matching between future supply and future project demand
- Support for four recommendation types:
  - `reassign`
  - `extend`
  - `fill_gap`
  - `release_warning`
- Demand-backed recommendations and inferred recommendations
- Reuse of existing PMO report pipeline where possible
- New fake data and regression tests

### Out of scope

- Replacing the existing workload health report
- Moving overbook/idle classification into LLM logic
- Letting LLM choose allocation percentages
- Cross-module staffing orchestration outside the PMO module
- Automatic writes to canonical RA without explicit user approval

---

## Design Principles

1. Deterministic engine decides all staffing logic.
2. LLM never decides capacity, overlap, role fit, demand gap, or suggested RA%.
3. LLM may only explain deterministic output.
4. Historical RA is supply/history evidence, not future truth.
5. Future recommendations require explicit modeling of demand.
6. If demand is missing, output must be labeled `inferred`, not `official`.
7. Report #2 should be a separate capability and contract, not an overload of report #1.
8. Only demand-backed rows may be framed as official proposal candidates.

---

## Decision Lock

These decisions should be treated as the default implementation contract unless product explicitly
changes them.

### DL-01. Planning start

- `planningStart = nextWorkingDay(evidenceTo + 1 day)`
- Example:
  - evidence window ends `2026-08-07`
  - `2026-08-08` is Saturday
  - planning start becomes `2026-08-10`

This prevents recommendation rows from starting on weekends by default.

### DL-02. Default horizon

- Default planning horizon = `8 weeks`
- `planningEnd` is derived from `planningStart`
- Caller may override later, but phase 1 should ship with a stable default

### DL-03. Recommendation authority

- `demand_backed` is the only mode allowed to read as an official allocation proposal candidate
- `inferred` is planning support only
- Missing demand plan must never be silently upgraded into `demand_backed`

### DL-04. Source assignment end semantics

- Historical RA is supply evidence
- `resource_allocations.end_date` is the deterministic source for "assignment ends on date X"
- If no future RA exists after that end date, the member may become available from the next working
  day
- If the assignment boundary is exactly the evidence boundary and PMO has not confirmed whether the
  work continues, the engine should emit a machine-readable quality flag such as
  `requires_assignment_confirmation`

This avoids silently treating evidence-window truncation as confirmed project completion.

### DL-05. Official demand source

Phase 1 official demand source:

- explicit rows in `pmo.project_demand_plan`

Non-official supporting signals may include:

- project still active in `project_master`
- repeated historical RA pattern
- member/project history fit

These signals may produce `inferred` rows only.

### DL-06. Partial allocation behavior

- Partial allocation is allowed
- Suggested RA must be capped by:
  - member available capacity
  - target demand gap
  - risk ceilings

If a full transfer is not safe, the engine should emit a partial recommendation instead of forcing
binary yes/no matching.

### DL-07. Deterministic top-N

- Each member-availability opportunity returns up to top `3` rows
- Fewer rows are valid when fewer viable matches exist
- Ranking must be stable for identical evidence and rules

---

## Current PMO State

The PMO module already contains a substantial amount of reusable infrastructure.

### Canonical data already available

From [`packages/pmo/src/backend/db/schema.ts`](../../packages/pmo/src/backend/db/schema.ts):

- `pmo.resource_allocations`
- `pmo.timesheets`
- `pmo.leave_records`
- `pmo.project_master`
- `pmo.member_master`
- `pmo.calendar_weeks`
- `pmo.member_week_facts`
- `pmo.member_skills_projection`
- `pmo.task_history_projection`
- `pmo.report_runs`

These are sufficient to model:

- historical and current RA coverage
- member capacity baseline
- project lifespan and ownership
- actual utilization and effort risk
- member skill and task history evidence

### Ingestion and canonical publish already available

The PMO ingest pipeline already supports:

- workbook upload
- sheet detection
- column mapping
- normalization to staging
- publish to canonical `pmo.*`
- report generation after publish

Relevant areas:

- [`packages/pmo/src/backend/ingestion/`](../../packages/pmo/src/backend/ingestion)
- [`packages/pmo/src/backend/workflows/ingest-data-v2/`](../../packages/pmo/src/backend/workflows/ingest-data-v2)
- [`packages/pmo/src/backend/planning/catalog.ts`](../../packages/pmo/src/backend/planning/catalog.ts)

### Existing workload-health analytics already available

The current analytics stack already computes:

- member-week facts
- available hours
- planned hours
- utilization
- effort consumption
- overbook/idle/mismatch findings

Relevant areas:

- [`packages/pmo/src/backend/analytics/`](../../packages/pmo/src/backend/analytics)
- [`packages/pmo/docs/formulas.md`](../../packages/pmo/docs/formulas.md)
- [`packages/pmo/docs/analytics-compute-contract.md`](../../packages/pmo/docs/analytics-compute-contract.md)

### Existing recommendation engine already available

The current PMO recommendation refactor delivered:

- period-based RA segmentation
- recommendation window with forward-looking planning start
- candidate slot modeling
- deterministic top-3 ranking
- skill/history/risk-based scoring
- report rendering for recommendation explanations

Relevant areas:

- [`packages/pmo/src/backend/reporting/recommendations/`](../../packages/pmo/src/backend/reporting/recommendations)
- [`docs/plans/pmo-recommendation-refactor-plan.md`](./pmo-recommendation-refactor-plan.md)

This is a strong base for report #2, but the current engine is still centered on
`source overbook member -> rebalance away from overload`.

### Existing report framework already available

The PMO report framework already supports:

- `createReportRun`
- `computeReportPayload`
- JSON and PDF rendering
- durable report persistence
- HTTP APIs for create/status/download/retry

Relevant areas:

- [`packages/pmo/src/backend/reporting/generate-report.ts`](../../packages/pmo/src/backend/reporting/generate-report.ts)
- [`packages/pmo/src/backend/http/report-routes.ts`](../../packages/pmo/src/backend/http/report-routes.ts)
- [`packages/pmo/src/backend/reporting/render/`](../../packages/pmo/src/backend/reporting/render)
- [`packages/pmo/docs/report-runbook.md`](../../packages/pmo/docs/report-runbook.md)

This should be reused rather than replaced.

---

## What Is Missing

The critical gaps are not around rendering or pipeline orchestration. They are around business
data and deterministic matching logic.

### Gap 1: No canonical project demand model

The PMO schema currently has project metadata, but it does not have future staffing demand data.

Missing concepts:

- project demand by role
- demand amount as FTE / allocation / weekly hours
- demand start and end
- demand urgency / priority
- demand source
- whether demand is confirmed or inferred

Without this, the system can say "member A becomes free", but not reliably say
"project B needs 0.5 FTE backend from week X to week Y".

This is the central missing piece.

### Gap 2: No forward supply model

The current PMO recommendation engine models source overbook opportunities and candidate spare
capacity, but not the new forward-allocation supply concepts:

- assignment ending soon
- available-from date
- available-until date
- projected member capacity after current RA ends
- release risk / bench risk

### Gap 3: No report family for forward allocation

Current `reportTypes` only support:

- `idle`
- `overbook`

There is no separate report contract or route behavior for:

- forward allocation recommendation
- demand-backed staffing proposals
- inferred future placement suggestions

### Gap 4: No demand ingest path

Current PMO ingest canonical domain config has sheets/tables for RA, timesheet, leave, project,
member, week, thresholds.

It does not have canonical support for:

- project demand plan
- role demand by project-period
- staffing request horizon

If the business wants upload-based demand planning, the canonical schema and ingest catalog must be
extended.

### Gap 5: No draft proposal model

If the user eventually wants review/approve and export a proposed RA plan, we will need a draft
proposal concept instead of reusing the existing historical/canonical RA rows directly.

Potential missing concepts:

- forward allocation proposal
- proposal lines
- draft vs approved vs rejected
- export or publish path

This can be deferred if phase 1 only generates read-only report output.

---

## Requirement Interpretation

The requirement should be interpreted as a separate workflow:

`RA Forward Allocation Recommendation`

### Workflow summary

```text
User uploads RA-related data or selects published PMO data
-> choose planning horizon (default 2 months)
-> normalize RA into member-week / project-week supply facts
-> normalize future supply from RA/member/leave/timesheet
-> identify assignments ending within horizon
-> compute available capacity after current allocation and leave/holiday effects
-> identify active projects in the horizon
-> identify project demand gaps within horizon
-> match supply to demand deterministically
-> rank recommendations
-> user reviews report
-> optional future phase: create staging RA draft
```

### Business reading of the workflow

This workflow is not "detect historical overload and suggest rebalancing".

It is "use historical and current PMO evidence to plan the next allocation move within a future
horizon".

That means:

- RA upload is mainly supply/history evidence
- future assignment proposals require target-side demand evidence
- when target-side demand evidence is weak or missing, the output must stay in inferred mode
- the report should be readable by PMO as a staffing-planning artifact, not a workload alert artifact

### Concrete example

The engine should support cases like:

- `EMP-118` ends `PRJ-101` on `2026-07-31`
- after that date, `EMP-118` has `40h/week` available capacity
- `PRJ-105` remains active in the same planning horizon
- `PRJ-105` has `Design 0.5 FTE` demand from `W32` to `W36`

Deterministic output should be able to say:

```text
Reassign EMP-118 from PRJ-101 to PRJ-105
Suggested RA: 0.5 FTE
Period: W32-W36
Reason: assignment ended, demand gap exists, role/skill fit is acceptable, projected busy rate remains safe
```

That row is only `demand_backed` if the target-side demand exists explicitly in the input model.
Otherwise it must be labeled `inferred`.

### Recommendation classes

The engine should support four deterministic recommendation types:

1. `reassign`
   Member finishes project A and is moved to project B that has demand.

2. `extend`
   Member stays on current project because the project still has demand and the fit remains strong.

3. `fill_gap`
   A project has future unmet capacity demand and a candidate should fill part or all of it.

4. `release_warning`
   Member is likely to go idle in the horizon and no strong demand-backed placement exists.

---

## Demand-backed vs Inferred

This distinction must be explicit in the contract and UI.

### Demand-backed recommendation

A recommendation is `demand_backed` only when the engine has deterministic evidence for:

- target project is active in the horizon
- target project has explicit demand gap
- demand role/skill/time window is known
- suggested capacity does not exceed demand
- time overlap exists between member availability and demand window

### Inferred recommendation

A recommendation is `inferred` when the engine can only infer likely placement from:

- historical RA and assignment history
- active project status
- skill match
- history fit
- member availability

but does not have explicit future demand records.

### Policy

- `demand_backed` may be shown as an allocation proposal candidate.
- `inferred` must be described as directional planning support only.
- LLM must not blur this distinction in wording.

### Wording rule

If a recommendation is `inferred`, UI/PDF/LLM wording must not imply confirmed staffing intent.

Forbidden wording for inferred rows:

- `official reassignment`
- `confirmed allocation`
- `approved staffing move`

Allowed wording:

- `inferred recommendation`
- `planning suggestion`
- `requires demand confirmation`

---

## Target Architecture

Report #2 should reuse the report framework but introduce a new deterministic domain layer.

### High-level shape

```text
canonical PMO data + optional demand plan
-> forward allocation evidence loader
-> supply builder
-> demand builder
-> deterministic matcher / scorer
-> forward allocation report payload
-> HTML/PDF render
-> optional LLM explanation
```

### Recommended package layout additions

Add a new namespace under PMO reporting:

```text
packages/pmo/src/backend/reporting/forward-allocation/
  contracts.ts
  load-evidence.ts
  supply.ts
  demand.ts
  match.ts
  score.ts
  generate.ts
  draft-proposals.ts        // later phase, optional
```

This keeps report #2 separate from current overbook rebalance logic under:

```text
packages/pmo/src/backend/reporting/recommendations/
```

---

## Data Sources And Rollout Modes

The report should support two rollout modes from day one at the design level.

### Mode 1. Demand-backed

Required inputs:

- canonical PMO RA/member/project data
- explicit `pmo.project_demand_plan`

Output semantics:

- official proposal candidate wording allowed
- recommendation mode = `demand_backed`

### Mode 2. Inferred

Required inputs:

- canonical PMO RA/member/project data
- optional skills/history/timesheet/leave
- no explicit demand plan

Output semantics:

- planning-support wording only
- recommendation mode = `inferred`
- must surface `requires_demand_confirmation` or equivalent evidence flags when appropriate

### Rollout recommendation

- Phase 1: seed demand-backed fixtures and support both modes in code
- Phase 2: add demand upload/publish path
- Phase 3: optional proposal draft approval workflow

---

## Reusable Components

The following should be reused as-is or with small extensions.

### Reuse directly

- report run lifecycle
- report persistence
- HTML/PDF rendering framework
- LLM explanation pattern
- rule snapshotting
- tenant-scoped canonical loading
- member/project/RA/time context
- recommendation projections for skills/history

### Reuse with extension

- recommendation window logic
  - can be adapted for `planningStart` + explicit horizon
- role compatibility
- skill coverage
- task history similarity
- risk gates
- ranking framework

### Do not reuse directly

- current `generateRebalanceRecommendations()`

Reason:

- it is source-overbook-centered
- it assumes relief from overloaded source opportunities
- it does not model project demand gaps as first-class targets

For report #2, demand must be first-class.

---

## New Domain Model

### 1. Planning horizon

```ts
interface ForwardAllocationWindow {
  evidenceFrom: string;
  evidenceTo: string;
  planningStart: string;
  planningEnd: string;
}
```

Default:

- `planningStart = nextWorkingDay(evidenceTo + 1 day)`
- `planningEnd = planningStart + 2 months` unless explicitly overridden

### 2. Member availability window

```ts
interface MemberAvailabilityWindow {
  memberId: string;
  currentProjectId: string | null;
  assignmentEndDate: string | null;
  availableFrom: string;
  availableTo: string | null;
  currentRaBusyRate: number;
  availableCapacityPct: number;
  availableCapacityHoursPerWeek: number;
  actualUtilization: number | null;
  overtimeRatio: number | null;
  leaveConflicts: Array<{ from: string; to: string; reason: string }>;
  riskFlags: string[];
  evidenceFlags: string[];
}
```

### 3. Project demand window

```ts
interface ProjectDemandWindow {
  demandId: string;
  projectId: string;
  roleNeeded: string;
  requiredSkills: string[];
  demandFrom: string;
  demandTo: string;
  demandPct: number;
  demandHoursPerWeek: number;
  urgency: 'low' | 'medium' | 'high';
  priorityScore: number;
  demandSource: 'uploaded_plan' | 'seeded_mock' | 'derived_inferred';
  confirmed: boolean;
  evidenceFlags: string[];
}
```

### 4. Recommendation output

```ts
interface ForwardAllocationRecommendation {
  recommendationId: string;
  type: 'reassign' | 'extend' | 'fill_gap' | 'release_warning';
  confidence: 'high' | 'medium' | 'low';
  recommendationMode: 'demand_backed' | 'inferred';
  memberId: string;
  currentProjectId: string | null;
  assignmentEndDate: string | null;
  availableFrom: string | null;
  targetProjectId: string | null;
  suggestedAllocationPct: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  score: number;
  scoreBreakdown: {
    availabilityOverlap: number;
    roleSkillMatch: number;
    demandUrgency: number;
    historicalFit: number;
    workloadBalance: number;
  };
  expectedBusyRateAfterAllocation: number | null;
  hardConstraintFlags: string[];
  dataQualityFlags: string[];
  rationale: string;
  risks: string[];
}
```

---

## Data Model Changes

### Required new canonical tables

Phase 1 should add a project-demand table.

Recommended starting table:

```ts
pmo.project_demand_plan
```

Suggested phase-1 schema shape:

```ts
export const projectDemandPlan = pmoSchema.table(
  'project_demand_plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').notNull(),
    natural_key_hash: text('natural_key_hash').notNull(),
    source_row_hash: text('source_row_hash').notNull(),
    last_ingestion_session_id: uuid('last_ingestion_session_id').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    demand_id: text('demand_id').notNull(),
    project_id: text('project_id').notNull(),
    role_needed: text('role_needed').notNull(),
    required_skills: jsonb('required_skills').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    demand_start: timestamp('demand_start', { withTimezone: true }).notNull(),
    demand_end: timestamp('demand_end', { withTimezone: true }).notNull(),
    demand_pct: real('demand_pct'),
    demand_hours_per_week: real('demand_hours_per_week'),
    urgency: text('urgency').notNull().default('medium'),
    priority_score: real('priority_score'),
    confirmed: boolean('confirmed').notNull().default(false),
    demand_source: text('demand_source').notNull().default('seeded_mock'),
    note: text('note'),
    source_row: integer('source_row'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('project_demand_plan_natural_key_unique').on(t.tenant_id, t.natural_key_hash),
    index('project_demand_plan_tenant_active').on(t.tenant_id, t.is_active),
    index('project_demand_plan_project_period').on(
      t.tenant_id,
      t.project_id,
      t.demand_start,
      t.demand_end,
    ),
  ],
);
```

Recommended invariants:

- at least one of `demand_pct` or `demand_hours_per_week` must be present
- `demand_end >= demand_start`
- `priority_score` should be normalized to a bounded range such as `0..1` or `0..100`
- `confirmed = true` is required for demand-backed rows in phase 1 unless product chooses a softer
  rule later

### Optional later tables

If the workflow later needs writeback/review:

- `pmo.forward_allocation_proposals`
- `pmo.forward_allocation_proposal_lines`

Suggested future intent:

- proposal header owns workflow status and reviewer decisions
- proposal line stores member/project/period/RA% suggestion
- canonical `resource_allocations` remain unchanged until explicit approval and publish path exist

These should not be introduced in the same phase unless proposal publishing is explicitly in scope.

---

## Ingestion Strategy

There are two viable rollout modes.

### Mode A: Report-first, demand mock first

Use this for fastest safe delivery.

Phase 1:

- add canonical demand table
- seed mock demand rows
- build deterministic engine
- ship report #2 against seeded or manually inserted demand data

Pros:

- fastest path to deterministic engine validation
- no need to modify workbook mapping immediately

Cons:

- user cannot upload demand plan in first release

### Mode B: Full upload path for demand

Phase 2 or later:

- extend PMO ingestion domain config
- add new sheet/table mapping for demand
- normalize and publish demand plan from workbook upload

Pros:

- end-to-end user upload workflow

Cons:

- broader change surface
- more planner/catalog/UI work

### Recommendation

Implement Mode A first, then Mode B.

---

## Deterministic Engine Design

### Supply builder

Input:

- `resource_allocations`
- `member_master`
- `leave_records`
- `timesheets`
- `calendar_weeks`

Responsibilities:

- identify assignments ending within horizon
- compute post-assignment available window
- compute spare capacity after current future RA
- reject members with actual overload risk
- classify likely idle/release cases

### Demand builder

Input:

- `project_master`
- `project_demand_plan`
- optional future confirmed RA rows

Responsibilities:

- find projects active in horizon
- load demand windows that overlap horizon
- calculate unresolved demand gaps by role/period
- tag `confirmed` vs `inferred`
- emit explicit evidence flags when a row depends on soft evidence only

### Matcher

Responsibilities:

- compute time overlap between availability and demand
- enforce hard filters
- score viable matches
- produce top-N per member and/or per demand gap

### Hard constraints

- member active
- overlap date exists
- target project active in overlap
- positive capacity
- not on conflicting leave/training
- not actually overloaded by timesheet risk
- role compatibility above minimum

### Scoring

Initial deterministic weights proposed by business:

- availability overlap: `0.30`
- role/skill match: `0.30`
- project demand urgency: `0.20`
- historical fit: `0.10`
- workload balance: `0.10`

These should live in a separate rules section for report #2, not be hard-coded.

---

## Matching Semantics

The matcher should work on two first-class entities:

- `MemberAvailabilityWindow`
- `ProjectDemandWindow`

### Availability-side opportunity

An availability opportunity exists when at least one of the following is true within the planning
horizon:

- a member assignment ends and leaves non-zero future capacity
- a member already has spare future capacity below target busy rate
- a member is likely to go idle or underallocated

### Demand-side opportunity

A demand opportunity exists when:

- project is active in the horizon
- project demand window overlaps the horizon
- unresolved demand remains after subtracting already-confirmed RA in the same overlap

### Recommendation typing rules

- `extend`: current project has overlapping explicit demand and member remains the best fit
- `reassign`: member leaves project A and matches project B demand
- `fill_gap`: a project demand gap is filled by a member who is not necessarily ending a current
  assignment immediately
- `release_warning`: member has future spare capacity but no strong fit was found

### Suggested allocation rule

Suggested RA percent should be:

```text
min(
  member available capacity,
  unresolved demand gap,
  risk-adjusted candidate ceiling
)
```

This rule must be deterministic and never delegated to LLM wording.

---

## Rule Configuration

Current PMO rule catalog is centered on workload-health metrics and overbook rebalancing.

Report #2 should extend rules with a dedicated branch, for example:

```json
"forwardAllocation": {
  "enabled": true,
  "defaultPlanningHorizonWeeks": 8,
  "recommendationTypes": ["reassign", "extend", "fill_gap", "release_warning"],
  "minimumRoleCompatibility": 0.7,
  "minimumSkillCoverage": 0.5,
  "actualUtilizationHardCeiling": 1.0,
  "overtimeRiskHardCeiling": 0.15,
  "topN": 3,
  "scoring": {
    "availabilityOverlap": 0.30,
    "roleSkillMatch": 0.30,
    "demandUrgency": 0.20,
    "historicalFit": 0.10,
    "workloadBalance": 0.10
  },
  "confidence": {
    "high": 0.8,
    "medium": 0.6,
    "low": 0
  }
}
```

This should be separate from the existing `recommendation` section to avoid mixing
overbook relief semantics with forward allocation demand matching semantics.

---

## Report Contract

Current report contracts are built around findings plus recommendation groups.

Report #2 should have its own payload family.

Recommended shape:

```ts
interface ForwardAllocationReportOutput {
  reportFamily: 'forward_allocation';
  recommendationModeSummary: {
    demandBacked: number;
    inferred: number;
  };
  dateRange: { from: string; to: string };
  planningHorizon: { from: string; to: string };
  summary: {
    memberAvailabilityCount: number;
    activeDemandWindowCount: number;
    demandBackedRecommendationCount: number;
    inferredRecommendationCount: number;
    releaseWarningCount: number;
  };
  rows: ForwardAllocationRecommendation[];
}
```

Recommended row-level additions:

```ts
interface ForwardAllocationRecommendation {
  memberName: string | null;
  currentProjectName: string | null;
  targetProjectName: string | null;
  memberRoleTitle: string | null;
  demandRoleTitle: string | null;
  evidence: {
    assignmentEndDate: string | null;
    availableFrom: string | null;
    demandFrom: string | null;
    demandTo: string | null;
    sourceAssignmentBusyRate: number | null;
    targetDemandHoursPerWeek: number | null;
  };
}
```

This should not be forced into the same finding model as workload health.
It should be a separate payload family and ideally a separate report type such as
`forward_allocation`.

### API direction

Current PMO report routes accept workload report types only. Report #2 should extend request
contracts explicitly rather than overloading existing finding semantics.

Recommended direction:

- keep the existing workload report request path stable
- add a new report type or family discriminator for forward allocation
- keep persistence inside `pmo.report_runs`, but separate envelope/report payload contracts

---

## Scoring Specification

The business-provided weights are directionally correct, but the plan should lock the mechanics.

### Score buckets

- `availabilityOverlap`: `0..1`
- `roleSkillMatch`: `0..1`
- `demandUrgency`: `0..1`
- `historicalFit`: `0..1`
- `workloadBalance`: `0..1`

### Weighted score

```text
score =
  availabilityOverlap * 0.30 +
  roleSkillMatch * 0.30 +
  demandUrgency * 0.20 +
  historicalFit * 0.10 +
  workloadBalance * 0.10
```

### Factor guidance

- `availabilityOverlap`
  - based on overlap duration and capacity coverage against the demand window
- `roleSkillMatch`
  - combines role compatibility and required skill coverage
- `demandUrgency`
  - derived from explicit urgency and priority score on demand
- `historicalFit`
  - based on past allocation/task/project evidence
- `workloadBalance`
  - rewards safer projected busy rate after transfer

### Confidence mapping

Recommended deterministic mapping:

- `high`: `score >= 0.80`
- `medium`: `0.60 <= score < 0.80`
- `low`: `score < 0.60`

These should live in rules so they can be tuned without changing engine shape.

---

## Rendering

The final report should render as a planning table, not a finding card stack.

Recommended columns:

- Member
- Current Project
- End Date
- Available From
- Recommended Project
- Suggested RA%
- Start-End
- Recommendation Type
- Reason
- Confidence
- Risks
- Action

For PDF:

- group by recommendation type or by target project
- clearly label `Demand-backed` vs `Inferred`
- do not present this as a historical workload report
- include demand evidence and projected busy-rate impact in row detail or appendix

---

## LLM Usage

Keep the same policy as the current PMO recommendation refactor.

### Deterministic only

The engine must decide:

- capacity
- overlap dates
- role fit
- skill fit thresholds
- demand gap size
- suggested allocation %
- recommendation type
- confidence bucket if deterministic

### LLM allowed only for

- explanation text
- risk/tradeoff summary
- business-facing action wording
- why top-1 ranks above top-2/top-3

### LLM forbidden from

- inventing demand
- inventing availability
- inventing dates
- changing suggested RA
- changing recommendation type

---

## Fake Data Strategy

Current PMO fake data is enough for workload-health and overbook rebalance, but not for
forward allocation demand matching.

New fixture set should add:

- project demand windows
- assignments ending within next 2 months
- members with future availability
- projects with confirmed demand gaps
- projects with only inferred likely demand
- cases with no match -> `release_warning`
- `extend` cases where the current project still has explicit demand
- `fill_gap` cases where a member is matched into a different project's future demand

Recommended new files under `hackathon/data/`:

- `pmo_02_project_demand_plan.csv`
- `pmo_02_forward_allocation_expected.csv`

Recommended minimum deterministic fixture matrix:

- one `extend` case with explicit confirmed demand on same project
- one `reassign` case with clear role/skill match to a different project
- one `fill_gap` case where project demand exists and multiple candidates compete
- one `release_warning` case with no acceptable demand match
- one `demand_backed` vs `inferred` comparison for the same member profile
- one partial-allocation case where capacity or risk prevents a full transfer
- one rejection case caused by leave conflict
- one rejection case caused by actual utilization ceiling
- one degraded-confidence case caused by missing skill/history evidence

This fixture matrix should exist before UI/report rendering is considered complete.

The current files can still be reused:

- `pmo_02_member_profiles.csv`
- `pmo_02_member_skills.csv`
- `pmo_02_member_task_history.csv`

---

## Phased Implementation Plan

## Phase 0 - Decision Lock

Lock these decisions before coding:

- default planning horizon = 8 weeks
- missing demand => `inferred`, not official
- four recommendation types
- deterministic engine owns all numeric decisions
- no canonical RA writeback in phase 1
- RA upload is supply/history evidence only
- official proposal wording allowed only for `demand_backed`
- demand plan is required for target-side official proposal confidence

Verification:

1. update this design doc and any linked PMO docs
2. confirm naming for `demand_backed` and `inferred`
3. confirm report type/family naming so route contracts do not drift

Acceptance:

- documented in contract and rules
- approved before schema work

## Phase 1 - Add Canonical Demand Model

Tasks:

1. Add `pmo.project_demand_plan` schema + migration.
2. Export new schema via PMO module.
3. Add load helpers for demand windows.
4. Add seed/mock data path for demand rows.

Verification:

1. migration generates cleanly
2. schema exports pass typecheck
3. integration test proves tenant-scoped insert/load/query for demand rows

Acceptance:

- tenant-scoped demand rows can be inserted and queried
- migration and typecheck pass

## Phase 2 - Build Forward Allocation Evidence Loader

Tasks:

1. Add `reporting/forward-allocation/contracts.ts`.
2. Add `load-evidence.ts` for:
   - members
   - projects
   - RA
   - leaves
   - timesheet risk summaries
   - skills/history projections
   - demand windows
3. Add planning horizon resolver.
4. Normalize RA into member-week and project-week supply facts for the planning horizon.

Verification:

1. unit tests for horizon boundary and next-working-day behavior
2. evidence loader test for seeded demand-backed and inferred-only modes
3. deterministic snapshot test for evidence payload ordering

Acceptance:

- evidence object is deterministic and testable
- horizon filtering works
- supply facts can be derived without LLM

## Phase 3 - Build Supply Side

Tasks:

1. Detect assignments ending within horizon.
2. Build `MemberAvailabilityWindow`.
3. Compute spare capacity after current future RA.
4. Annotate leave/training conflict and actual overload risk.
5. Distinguish fully released vs partially available members.

Verification:

1. unit tests for assignment-end detection
2. unit tests for available-from/available-to derivation
3. integration tests for partial capacity and release-warning scenarios

Acceptance:

- engine can identify future-available members
- release-risk cases are explicit

## Phase 4 - Build Demand Side

Tasks:

1. Load active project demand windows.
2. Compute unresolved demand gap by project + role + period.
3. Mark `confirmed` vs `inferred`.
4. Distinguish demand patterns for:
   - `extend`
   - `reassign`
   - `fill_gap`

Verification:

1. unit tests for demand-window overlap and gap subtraction
2. tests for confirmed demand vs derived inferred demand labeling
3. fixtures covering multiple demand windows on one project

Acceptance:

- engine can express project demand as first-class windows

## Phase 5 - Deterministic Matching and Ranking

Tasks:

1. Add matcher between availability windows and demand windows.
2. Implement hard filters.
3. Implement scoring:
   - availability overlap
   - role/skill match
   - demand urgency
   - historical fit
   - workload balance
4. Support top-3 rows when multiple targets are relevant.
5. Emit one of:
   - `reassign`
   - `extend`
   - `fill_gap`
   - `release_warning`

Verification:

1. unit tests for hard filters
2. golden tests for stable ranking and top-3 truncation
3. integration tests for each recommendation type
4. regression tests proving `demand_backed` and `inferred` wording mode stay distinct

Acceptance:

- deterministic ranking is stable
- no LLM dependency for candidate choice
- demand-backed and inferred rows are distinguishable in contract and behavior

## Phase 6 - New Report Contract and Route Integration

Tasks:

1. Add a new report mode/family to PMO reporting contracts.
2. Extend `createReportRun` / `computeReportPayload` to support report #2.
3. Keep report #1 and report #2 isolated internally.

Verification:

1. route contract tests for new report family/type
2. report-run persistence tests for forward allocation payload
3. regression tests proving workload report output is unchanged

Acceptance:

- existing workload-health report remains unchanged
- forward allocation report run is durable and downloadable

## Phase 7 - Render and Explanation

Tasks:

1. Add HTML/PDF renderer for planning-table layout.
2. Add LLM explanation payload for forward allocation rows.
3. Label `Demand-backed` vs `Inferred`.

Verification:

1. HTML snapshot tests
2. PDF smoke render test
3. explanation payload tests proving LLM receives deterministic facts, flags, scores, and mode only

Acceptance:

- report reads like a staffing planning artifact, not a workload alert report

## Phase 8 - Demand Upload Path

Tasks:

1. Extend PMO domain config for demand sheet/table.
2. Add planner metadata and workflow steps if needed.
3. Normalize + publish demand plan from workbook upload.

Verification:

1. ingestion planner tests
2. normalization/publish integration tests
3. end-to-end upload-to-report test with demand-backed recommendations

Acceptance:

- user can upload demand-backed planning input end to end

## Phase 9 - Optional Proposal Draft Workflow

Tasks:

1. Add draft proposal tables if needed.
2. Add review/approve/export behavior.
3. Keep write actions behind explicit approval.

Verification:

1. proposal persistence tests
2. approval workflow tests
3. non-destructive guarantee: no canonical RA mutation without explicit approval

Acceptance:

- report can evolve into staging RA draft creation without redesign

---

## Risks

### Risk 1: No demand input in first release

Impact:

- report can only produce inferred recommendations

Mitigation:

- make labeling explicit
- seed/mock demand for acceptance tests
- add upload path in later phase

### Risk 2: Confusing report #1 and report #2 semantics

Impact:

- overbook rebalance and forward staffing become mixed and hard to explain

Mitigation:

- separate contracts
- separate deterministic namespace
- separate UI/report wording

### Risk 3: Historical RA mistaken as future confirmed plan

Impact:

- false confidence in future proposal

Mitigation:

- preserve current rule that historical RA is evidence only
- label inferred mode
- require demand-backed evidence for official proposals

### Risk 4: Scope explosion into staffing platform

Impact:

- PMO feature turns into general staffing orchestration too early

Mitigation:

- keep phase 1 read-only
- keep proposal publishing out of initial scope

---

## Recommendation

Proceed in this order:

1. Design lock
2. Canonical demand model
3. Forward-allocation deterministic engine
4. New report contract/render
5. Demand upload path
6. Optional proposal draft workflow

This keeps the implementation production-grade while minimizing risk to the existing PMO report
pipeline.

---

## Implementation Readiness Summary

### Ready now

- canonical PMO report pipeline
- report run persistence
- HTML/PDF framework
- skill/history projections
- deterministic scoring infrastructure
- planning horizon logic

### Not ready yet

- project demand canonical model
- demand upload path
- forward allocation contracts
- supply/demand matching engine
- proposal draft/writeback model

### Bottom line

The PMO module is already strong enough to support report #2 architecturally.
The main missing piece is not reporting infrastructure.
The main missing piece is a deterministic future-demand model and matching layer.
