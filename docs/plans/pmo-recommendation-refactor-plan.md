# PMO recommendation refactor plan

Refactor plan for PMO overbook recommendations so the engine produces forward-looking rebalancing actions from the uploaded evidence window, instead of deriving weekly recommendations directly from report summary findings.

This plan is implementation-oriented. It is written so a contributor can execute it phase by phase without re-deriving the design.

---

## Goal

Replace the current `member-week fact -> recommendation` flow with:

```text
uploaded workbook / published PMO data
-> normalize RA + member/project masters + skills/history + timesheet risk signals
-> detect RA-based capacity issues by member + active period
-> create rebalance opportunities
-> build eligible candidate slots for the future planning horizon
-> rank top-3 candidates per opportunity
-> emit forward-looking transfer recommendations
```

For the hackathon PMO_02 dataset:

- Evidence window: `2026-06-29` to `2026-08-07`
- Planning start candidate: `2026-08-08`
- Working planning start: `2026-08-10` via `nextWorkingDay(evidenceTo + 1 day)`
- Recommendation period: `2026-08-10 -> min(project_end_date, candidate_availability_end, selected planning horizon)`

Evidence from `W1..W6` remains explanatory only. Recommendations must not be phrased as if they modify the already-completed weeks.

---

## Decision lock

These decisions must be locked before implementation begins. The rest of the plan assumes the defaults below unless PMO explicitly overrides them.

| Decision | Default | Why it matters |
|---|---|---|
| Weekend effective date | `planningStart = nextWorkingDay(evidenceTo + 1 day)` | Staffing actions should not start on a weekend by default. |
| Official red boundary | `ra_busy_rate >= 1.20` | Avoids ambiguity at exactly `120%`; easier to test and explain. |
| Source target / candidate ceiling | `sourceTargetBusyRate = 1.00`, `candidateSoftCeiling = 1.00`, `candidateHardCeiling = 1.05` | Separates desired target from absolute safety limit. |
| Allocation end semantics | Workbook `DS01.End_date` is treated as evidence coverage unless explicitly confirmed as future assignment end | Prevents empty recommendations when upload windows stop at the report boundary. |
| Partial relief behavior | `allowPartialRelief = true` only when candidate stays `<= candidateHardCeiling` and source relief is still directionally useful | Makes partial recommendations explicit and bounded. |

### Locked defaults

```ts
interface RecommendationDecisionLock {
  planningStartMode: 'next_working_day';
  officialOverbookRedBoundary: { gte: 1.2 };
  sourceTargetBusyRate: 1.0;
  candidateSoftCeiling: 1.0;
  candidateHardCeiling: 1.05;
  allowPartialRelief: true;
  sourceAllocationEndSemantics: 'evidence_coverage_until_confirmed';
}
```

Implementation note:
- if PMO later confirms `DS01.End_date` is a true future assignment end, the engine may switch to `assignment_end_confirmed`
- until then, the recommendation engine must not silently collapse opportunities just because `DS01.End_date == evidenceTo`

---

## Current problem

Current implementation in [generate.ts](../../packages/pmo/src/backend/reporting/recommendations/generate.ts):

- starts from `Finding[]` and `MemberWeekFact[]`
- iterates `overbook` member-weeks
- uses candidate pool by same `weekId`
- simulates transfer by `plannedHours / availableHours`
- ranks candidates after the weekly pool is already chosen

This causes 4 structural problems:

1. Detection grain is wrong.
   Recommendation should work on `member + active period + project/role`, not `member + week`.

2. Time direction is wrong.
   Report evidence is historical; recommendation should start at `report.to + 1 day`.

3. Busy signal is wrong for official overbook detection.
   Official overbook should come from RA allocation percent in the active period, not from week-adjusted `planned / available`.

4. Candidate eligibility is too loose.
   Current candidate pool only checks `same week + in scope + availableHours > 0` before skill filters.

---

## Scope

### In scope

- Recommendation pipeline only
- New intermediate model: `rebalance opportunity`
- New candidate-slot model for future planning horizon
- Top-3 recommendations per overbook opportunity when available
- Hackathon fake data updates under `hackathon/data/`
- Rules/config updates needed to score recommendations consistently
- Backend tests and report rendering changes required by the new output

### Out of scope

- Replacing existing PMO member-week facts for analytics dashboards
- Replacing mismatch analytics logic for Problem 2 summary
- Agent prompting or natural-language narrative generation
- Full cross-module staffing orchestration outside PMO

---

## Canonical data sources for this refactor

### Upload workbook

Primary upload workbook:
- [PMO_02_RA_Timesheet_Monitoring.xlsx](../../hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx)

Relevant sheets:
- `DS01_Resource_Allocation`
- `DS02_Timesheet_Log`
- `DS03_Overbook_Idle_Config`
- `DS04_Leave_Holiday_Records`
- `DS05_Project_Master`
- `DS06_Member_Master`
- `REF_Calendar_Weeks`
- `REF_KPI_Norms`

### Fake recommendation evidence

These files should become the canonical fake evidence set for recommendation tests and demo output:
- [pmo_02_member_profiles.csv](../../hackathon/data/pmo_02_member_profiles.csv)
- [pmo_02_member_skills.csv](../../hackathon/data/pmo_02_member_skills.csv)
- [pmo_02_member_task_history.csv](../../hackathon/data/pmo_02_member_task_history.csv)
- [pmo_02_rebalance_swaps.csv](../../hackathon/data/pmo_02_rebalance_swaps.csv)

The current fake data is useful, but it is still shaped around weekly relief examples. It needs to be reworked so it supports period-based opportunity generation and top-3 ranking.

---

## Target design

### 1. Separate evidence window from planning horizon

Introduce explicit terms in the backend contract:

```ts
interface RecommendationWindow {
  evidenceFrom: string;      // inclusive
  evidenceTo: string;        // inclusive
  planningStart: string;     // nextWorkingDay(evidenceTo + 1 day)
  planningEnd: string | null; // optional explicit horizon; null => per-project end
}
```

Rules:
- `planningStart = nextWorkingDay(report.dateRange.to + 1 day)`
- if request has no explicit planning horizon, each recommendation uses:
  - `effective_from = planningStart`
  - `effective_to = min(project.end_date, target capacity period end, explicit planning horizon if present)`
- source allocation end is excluded from `effective_to` until PMO confirms that `DS01.End_date` is a future assignment end rather than only the evidence window boundary
- if a recommendation would otherwise have an empty period because future assignment coverage is unconfirmed, emit `requires_ra_confirmation` instead of silently dropping the opportunity

### 2. Official overbook detection must be RA-based

Define a dedicated RA-based metric for recommendation decisions:

```text
ra_busy_rate = SUM(allocation_pct) across allocations active in the same segment
```

Status bands:
- `< 0.75` => `idle_red`
- `0.75 - 0.84` => `underallocated_watch`
- `0.85 - 1.10` => `normal`
- `1.11 - 1.19` => `overbook_warning`
- `>= 1.20` => `overbook_red`

Rules:
- only `>= 1.20` produces official overbook rebalance opportunities by default
- `1.11 - 1.19` may produce `warning_only` opportunities later, but Phase 1 should not generate transfer recommendations for them unless explicitly enabled

### 3. Timesheet is a validator, not the primary detector

Timesheet-derived signals remain important, but only as candidate/source constraints and risk flags:

- `actual_utilization = worked_h / available_h`
- `effort_consumption = actual_h / planned_h`
- `bench_rate = bench_h / available_h`
- `ot_ratio = ot_h / std_h`

Timesheet must influence:
- source urgency and transfer size caps
- candidate eligibility
- confidence and risk text

Timesheet must not be the main source for deciding whether a member is officially overbook or idle.

### 4. Introduce rebalance opportunity as the core unit

Create a new deterministic entity:

```ts
interface RebalanceOpportunity {
  opportunityId: string;
  sourceMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  severity: 'warning' | 'red';
  activePeriod: {
    from: string;
    to: string;
  };
  planningPeriod: {
    from: string;
    to: string;
  };
  currentRaBusyRate: number;
  sourceTargetBusyRate: number;
  candidateSoftCeiling: number;
  candidateHardCeiling: number;
  allowPartialRelief: boolean;
  reliefNeededPct: number;
  reliefNeededHoursPerWeek: number;
  sourceRiskFlags: string[];
  sourceValidation: {
    actualUtilization: number | null;
    effortConsumption: number | null;
    overtimeRatio: number | null;
  };
}
```

One source member can yield multiple opportunities:
- one per `project_id + role + segmented active period`
- not one per week

### 5. Introduce candidate slot as the eligibility unit

Create a future-facing capacity object:

```ts
interface CandidateSlot {
  memberId: string;
  roleTitle: string | null;
  allocationRoleSet: string[];
  activePeriod: {
    from: string;
    to: string;
  };
  planningOverlap: {
    from: string;
    to: string;
  };
  currentRaBusyRate: number;
  targetRaBusyRate: number;
  availableCapacityPct: number;
  availableCapacityHoursPerWeek: number;
  actualUtilization: number | null;
  effortConsumption: number | null;
  overtimeRatio: number | null;
  leaveConflict: boolean;
  trainingConflict: boolean;
  candidateRiskFlags: string[];
}
```

Candidate eligibility requires all of:
- active employee
- overlap with opportunity planning period
- positive spare RA capacity to candidate soft ceiling
- no blocking leave/training conflict in planning start window
- not actually overloaded by timesheet risk gates
- role/skill match above minimum threshold

---

## Skill, history, and embedding policy

## Recommendation

Use a hybrid model:
- deterministic rules for hard filtering and baseline score
- embeddings only for soft similarity in task-history matching

Do not use embeddings as the only skill-match or role-match mechanism.

### Why

Embedding-only matching is too soft for staffing decisions:
- it can blur adjacent but non-interchangeable roles
- it is hard to explain in audit output
- it is risky for sparse/noisy hackathon data

Rule-based skill and role matching should remain the primary decision path because it is:
- auditable
- deterministic
- easy to threshold
- safe for business users

Embeddings are still useful for one job only:
- ranking historical experience similarity once hard eligibility already passed

### Final policy

1. Hard filters use structured data only:
- allocation role
- declared skills
- employment status
- capacity
- leave/training conflict
- actual overload risk

2. Base score uses structured scoring only.

3. Embedding similarity contributes only to `task history similarity`, capped as one weighted component of the final score.

4. If embeddings are missing, recommendation still works with degraded confidence.

---

## Matching and scoring standard

Each opportunity returns up to top-3 candidates.

- If 3 valid candidates exist: return top 3
- If only 2 valid candidates exist: return top 2
- If only 1 valid candidate exists: return top 1
- If none exist: return no result with explicit reasons

### Hard filter sequence

A candidate fails immediately if any of these are false:

1. `planning overlap exists`
2. `candidate employment_status = active`
3. `available_capacity_pct > 0`
4. `candidate current RA busy rate < candidateHardCeiling`
5. `candidate actual utilization < overload cutoff`
6. `candidate overtime ratio < OT risk cutoff`
7. `role compatibility >= minimum role threshold`
8. `skill coverage >= minimum skill threshold`

Recommended initial thresholds:
- overload cutoff by actual utilization: `< 1.00` for strong candidates, `< 1.05` for tolerated partial candidates
- OT risk cutoff: `< 0.10` normal, `< 0.15` tolerated partial candidates
- minimum skill coverage: `0.60`
- minimum role compatibility: `0.70`

Definitions:
- `sourceTargetBusyRate`: desired source post-transfer target, typically `1.00`
- `candidateSoftCeiling`: preferred candidate post-transfer target, typically `1.00`
- `candidateHardCeiling`: absolute allowed candidate post-transfer cap for partial relief, typically `1.05`
- `allowPartialRelief`: when `true`, a candidate may still be emitted if they exceed the soft ceiling but remain at or below the hard ceiling

### Final candidate score

Normalize all components to `0..1`.

```text
final_score =
  0.35 * skill_match
+ 0.25 * history_match
+ 0.20 * role_context_match
+ 0.15 * capacity_fit
+ 0.05 * risk_adjustment
```

The current rule schema already supports weighted scoring; extend it rather than bypassing it.

### Component definitions

#### 1. Skill match: 35%

`skill_match` is the primary ranking signal.

Per required skill:
- exact skill + equal/higher proficiency => `1.00`
- exact skill + lower proficiency by 1 level => `0.80`
- exact skill + lower proficiency by 2+ levels => `0.60`
- adjacent/approved substitute skill => `0.50`
- missing => `0.00`

Then apply importance weighting:
- primary role skills: weight `2.0`
- secondary role/domain skills: weight `1.0`

Formula:

```text
skill_match = weighted_sum(skill_component) / weighted_sum(max_component)
```

#### 2. History match: 25%

Use structured signals first, embeddings second.

Suggested composition:

```text
history_match =
  0.50 * project_history_match
+ 0.30 * domain_history_match
+ 0.20 * embedding_similarity
```

Where:
- same project before => `1.00`
- same project family / account => `0.80`
- same domain / project type => `0.60`
- none => `0.00`

`embedding_similarity` is cosine similarity over task embeddings, clamped to `0..1`.

If embeddings are absent:
- compute history score from structured history only
- add degraded flag: `task_embeddings_missing`

#### 3. Role context match: 20%

```text
role_context_match =
  0.50 * allocation_role_match
+ 0.20 * title_match
+ 0.15 * level_proximity
+ 0.15 * department_match
```

Suggested rule values:
- exact allocation role => `1.00`
- allowed adjacent role => `0.70`
- unrelated role => `0.00`

Level proximity:
- same level => `1.00`
- ±1 level => `0.80`
- ±2 levels => `0.50`
- beyond that => `0.20`

Department:
- same department => `1.00`
- compatible department cluster => `0.60`
- otherwise => `0.00`

#### 4. Capacity fit: 15%

The candidate should have enough future capacity without pushing them into risk.

```text
capacity_fit = min(
  available_capacity_pct / required_relief_pct,
  1.0
)
```

Then dampen if candidate would land too close to ceiling:
- projected RA <= `0.95` => no penalty
- `0.96 - 1.00` => `0.90x`
- `1.01 - 1.05` => `0.70x`
- `> 1.05` => reject

Policy:
- `projected RA <= candidateSoftCeiling` => eligible for full-fit ranking
- `candidateSoftCeiling < projected RA <= candidateHardCeiling` => only eligible when `allowPartialRelief = true`
- `projected RA > candidateHardCeiling` => reject

#### 5. Risk adjustment: 5%

Start at `1.00`, then subtract penalties:
- actual utilization `0.95 - 1.00` => `-0.15`
- actual utilization `>1.00` => reject or severe penalty
- OT ratio `0.10 - 0.15` => `-0.15`
- repeated bench-only history on unrelated work => `-0.10`
- data quality degraded => `-0.10`

Clamp to `0..1`.

### Confidence labels

Suggested initial confidence bands:
- `high`: `>= 0.80`
- `medium`: `0.65 - 0.79`
- `low`: `0.50 - 0.64`
- below `0.50`: do not emit unless explicitly requested

---

## Fake data changes required

The current hackathon recommendation fake data is close, but it needs to be period-aware and top-3-complete.

### Files to update

1. [pmo_02_member_profiles.csv](../../hackathon/data/pmo_02_member_profiles.csv)
2. [pmo_02_member_skills.csv](../../hackathon/data/pmo_02_member_skills.csv)
3. [pmo_02_member_task_history.csv](../../hackathon/data/pmo_02_member_task_history.csv)
4. [pmo_02_rebalance_swaps.csv](../../hackathon/data/pmo_02_rebalance_swaps.csv)

### Required additions

#### Member profiles

Ensure candidate members such as `EMP-103`, `EMP-113`, and other alternates exist with:
- `department`
- `role_title`
- `level`
- `allocation_roles`
- `employment_status`
- `std_hours_week`
- `join_date`
- `source_version`

Also add at least one intentionally bad candidate for each main role family to exercise rejection logic:
- role mismatch candidate
- high-utilization candidate
- leave-conflict candidate

#### Member skills

For each overbook source role family, provide at least 4-5 downstream candidates with varied skill quality:
- 2 exact strong matches
- 1 acceptable adjacent match
- 1 weak partial match
- 1 mismatch candidate

This is necessary to validate deterministic top-3 ordering.

#### Member task history

Add enough task history so candidate ranking can be differentiated by:
- same project
- same account or domain
- same role but different domain
- unrelated role/domain

Also generate embedding text consistently for all ranked candidates.

#### Rebalance swaps

Treat [pmo_02_rebalance_swaps.csv](../../hackathon/data/pmo_02_rebalance_swaps.csv) as expected-output seed data, not the recommendation engine input.

Refactor it to represent expected top-ranked transfer actions per opportunity:
- one row per source opportunity x candidate recommendation
- include `effective_from`, `effective_to`, `expected_rank`, `expected_confidence`
- include `reason_summary`

Suggested new columns:

```text
source_member_id,source_member_name,target_member_id,target_member_name,
project_id,project_name,role,effective_from,effective_to,
transferable_pct,transferable_hours_per_week,
expected_rank,expected_confidence,
skill_fit_score,history_fit_score,capacity_fit_score,
can_swap,rationale
```

### Data scenarios that must exist after refresh

1. `EMP-004` overbook red on `PRJ-001` with 3 ranked BE candidates
2. `EMP-004` overbook red on `PRJ-002` with 2 ranked BE candidates and 1 rejected due to actual overload
3. `EMP-001` overbook warning or yellow, but not yet official red if business rule excludes `111-119%`
4. one UX/UI case where only design-aligned candidates rank
5. one false-idle case where RA looks free but actual utilization is too high, so candidate is rejected
6. one candidate with no embeddings so the result is still returned but marked degraded

---

## Output contract to implement

Replace weekly recommendation output with opportunity-based output.

```ts
interface RebalanceRecommendationGroup {
  opportunityId: string;
  sourceMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  severity: 'warning' | 'red';
  evidenceWindow: {
    from: string;
    to: string;
  };
  planningPeriod: {
    from: string;
    to: string;
  };
  currentRaBusyRate: number;
  targetRaBusyRate: number;
  requiredReductionPct: number;
  requiredReductionHoursPerWeek: number;
  status: 'full_solution' | 'partial_relief' | 'no_valid_rebalance_found';
  recommendations: RebalanceRecommendation[];
  noResultReasons: string[];
  recommendationDegraded: boolean;
  dataQualityFlags: string[];
}

interface RebalanceRecommendation {
  sourceMemberId: string;
  targetMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  effectiveFrom: string;
  effectiveTo: string;
  transferPct: number;
  transferHoursPerWeek: number;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  rankWithinOpportunity: 1 | 2 | 3;
  scoreBreakdown: {
    skillMatch: number;
    historyMatch: number;
    roleContextMatch: number;
    capacityFit: number;
    riskAdjustment: number;
  };
  evidence: {
    matchedSkills: string[];
    missingSkills: string[];
    similarPastTasks: string[];
    sourceRiskFlags: string[];
    candidateRiskFlags: string[];
    rationale: string;
  };
}
```

Rendering rule:
- UI/PDF must show `effectiveFrom` and `effectiveTo`
- UI/PDF must not lead with `W1/W2/W3` as the primary recommendation grouping
- historical weeks may appear as evidence only

---

## Phase plan

## Phase 0 - Lock business contract and terminology

### Objective

Freeze the recommendation contract before editing pipeline code.

### Steps

1. Add a short design doc section to PMO reporting docs defining:
   - evidence window
   - planning start
   - planning horizon
   - rebalance opportunity
   - candidate slot

2. Lock weekend handling:
   - default `planningStart = nextWorkingDay(evidenceTo + 1 day)`
   - PMO may override only via explicit planning date input

3. Confirm business default:
   - official overbook recommendation only from `ra_busy_rate >= 1.20`
   - `1.11 - 1.19` remains warning only unless enabled later

4. Lock source/candidate ceiling semantics:
   - `sourceTargetBusyRate`
   - `candidateSoftCeiling`
   - `candidateHardCeiling`
   - `allowPartialRelief`

5. Lock source allocation end semantics:
   - whether workbook `DS01.End_date` is future assignment truth or only evidence coverage

6. Confirm top-N rule:
   - return up to 3 candidates per opportunity

### Deliverables

- doc updates
- frozen TypeScript interface draft in plan or implementation notes

### Exit criteria

- no unresolved ambiguity remains for:
  - weekend effective date
  - `>= 1.20` vs `> 1.20`
  - source/candidate ceiling semantics
  - source allocation end semantics
  - partial relief behavior

---

## Phase 1 - Build normalized recommendation inputs

### Objective

Prepare deterministic period-based inputs instead of weekly recommendation inputs.

### Steps

1. Introduce a recommendation normalization layer under `packages/pmo/src/backend/reporting/recommendations/`.

2. Create a function to segment RA into active periods.

Suggested output:

```ts
interface AllocationSegment {
  memberId: string;
  projectId: string;
  role: string | null;
  from: Date;
  to: Date;
  allocationPct: number;
  weeklyPlannedHours: number | null;
}
```

3. Merge segments per member into period summaries:
- sum active allocation pct
- collect contributing projects
- preserve per-project contribution for later relief split

4. Add project-master loading to recommendation evidence.

5. Extend recommendation evidence loading with:
- `level`
- `employment type`
- `employment status`
- `project type/domain`
- `project end_date`

6. Add a function that computes source/candidate actual risk summaries from timesheet evidence over the evidence window.

7. Add `nextWorkingDay()` utility based on working calendar semantics so `planningStart` is deterministic and testable.

### Files likely to change

- `load-evidence.ts`
- recommendation contracts
- new normalization files

### Exit criteria

- code can produce normalized member/project periods from PMO_02 workbook data

---

## Phase 2 - Minimum fixture refresh for design validation

### Objective

Refresh the minimum fake evidence set early so opportunity generation and ranking tests are not written against underspecified data.

### Steps

1. Update [pmo_02_member_profiles.csv](../../hackathon/data/pmo_02_member_profiles.csv) with:
   - `EMP-004`
   - 3 BE candidates
   - 1 BE candidate rejected for actual overload
   - 1 BE candidate with missing embedding

2. Update [pmo_02_member_skills.csv](../../hackathon/data/pmo_02_member_skills.csv) so those candidates have:
   - 2 exact strong matches
   - 1 acceptable adjacent match
   - 1 weak/mismatch candidate

3. Update [pmo_02_member_task_history.csv](../../hackathon/data/pmo_02_member_task_history.csv) so at least:
   - one candidate has same project/domain history
   - one candidate has same role but weaker domain history
   - one candidate has no embeddings

4. Update [pmo_02_rebalance_swaps.csv](../../hackathon/data/pmo_02_rebalance_swaps.csv) with provisional expected top-3 rows for `EMP-004`.

### Exit criteria

- fixture data is sufficient to write meaningful opportunity and ranking tests

---

## Phase 3 - Introduce rebalance opportunity generation

### Objective

Generate official overbook opportunities from RA segments.

### Steps

1. Create `buildRebalanceOpportunities()`.

2. Input:
- normalized allocation segments
- project master
- member master
- recommendation window
- RA thresholds
- timesheet validation summaries

3. For each source member and active segment:
- compute `ra_busy_rate`
- classify warning/red
- for each contributing project allocation, compute transferable relief share

4. Split opportunity by `project_id + role + active planning period`.

5. Compute:
- `requiredReductionPct`
- `requiredReductionHoursPerWeek`
- `planningPeriod.from = nextWorkingDay(evidenceTo + 1 day)`
- `planningPeriod.to = min(project_end, explicit planning horizon if present, confirmed assignment end if available)`

6. Attach source risk signals from timesheet evidence.

7. Exclude opportunities whose planning period is empty.

### Exit criteria

- PMO_02 produces explicit opportunities for `EMP-004` instead of `W1..W6` weekly groups
- if future assignment end is not confirmed, opportunities surface `requires_ra_confirmation` rather than disappearing

---

## Phase 4 - Build candidate slots and hard filters

### Objective

Create future-facing candidate capacity slots and reject unsafe candidates before scoring.

### Steps

1. Create `buildCandidateSlots()` from normalized member allocation periods.

2. Compute candidate future spare capacity:

```text
available_capacity_pct = target_ceiling - current_ra_busy_rate
available_capacity_hours_per_week = available_capacity_pct * std_hours_week
```

3. Intersect each candidate slot with opportunity planning period.

4. Add hard filters for:
- active status
- positive planning overlap
- positive spare capacity
- leave conflict
- training conflict
- actual overload risk
- OT risk
- role compatibility minimum
- skill threshold minimum

5. Record explicit rejection reasons for diagnostics.

Suggested rejection reason codes:
- `no_planning_overlap`
- `inactive_member`
- `no_spare_capacity`
- `leave_conflict`
- `training_conflict`
- `actual_utilization_too_high`
- `ot_risk_too_high`
- `role_mismatch`
- `skill_coverage_below_threshold`

### Exit criteria

- PMO_02 opportunity for each source member has a deterministic eligible candidate set before ranking

---

## Phase 5 - Implement ranking and top-3 selection

### Objective

Replace weekly ranking with opportunity-based top-3 ranking.

### Steps

1. Refactor current scoring into the new 5-part score:
- skill match
- history match
- role context match
- capacity fit
- risk adjustment

2. Keep weights in report rules.

3. Extend rule schema to represent the new components if needed.

4. Add top-3 cap logic per opportunity.

5. Preserve deterministic sort order:
- score desc
- skill match desc
- history match desc
- target member id asc

6. Keep degraded confidence behavior when embeddings or structured evidence are missing.

7. Generate explicit rationale text from structured components.

Example:

```text
EMP-004 is 125% RA on PRJ-001. Recommend moving 15% allocation to EMP-103 from 2026-08-10 to 2026-12-19. EMP-103 has 40% spare RA capacity, exact BE role match, 6/6 required skills, and prior core-banking backend history.
```

### Exit criteria

- each overbook opportunity returns up to 3 ranked candidates
- ranking is deterministic and explainable

---

## Phase 6 - Render forward-looking recommendation output

### Objective

Make UI/PDF/report payload reflect future actions, not historical week cards.

### Steps

1. Update report contracts and repository persistence for the new recommendation group shape.

2. Update HTML/PDF rendering:
- show planning period prominently
- show evidence window separately
- show top-3 list under each source opportunity
- show reasons when only top-1 or top-2 exist

3. Remove weekly recommendation language such as:
- `Week W1`
- `affected week W3`

from recommendation headers.

4. Historical week tables remain allowed only in the evidence section.

### Exit criteria

- recommendation UI reads as a future staffing action plan

---

## Phase 7 - Full fixture refresh and golden expectations

### Objective

Make hackathon data a stable acceptance fixture for recommendation ranking after the pipeline shape is stable.

### Steps

1. Update member profiles, skills, and task history as described above.

2. Regenerate or hand-curate expected recommendation rows in `pmo_02_rebalance_swaps.csv`.

3. Make sure each major overbook case has:
- top-3 candidates when possible
- at least one rejected near-miss candidate
- one degraded candidate path with missing embedding

4. Add a small README section or comments documenting that these files are recommendation fixtures.

### Exit criteria

- fake data directly supports acceptance tests and manual demo validation

---

## Phase 8 - Tests

### Objective

Provide regression coverage for the full recommendation pipeline.

### Required tests

1. Unit: RA segmentation
- splits active periods correctly
- handles overlapping allocations
- respects planning start after evidence window

2. Unit: opportunity generation
- `EMP-004` generates period-based opportunities, not 6 weekly ones
- warning vs red threshold behavior is correct

3. Unit: candidate hard filters
- rejects role mismatch
- rejects actual-overloaded idle candidate
- rejects leave-conflict candidate

4. Unit: ranking
- top-3 returned in stable order
- embeddings improve ranking but do not override hard mismatch
- degraded result still emitted when embeddings are missing

5. Integration: report generation using PMO_02 workbook + fake evidence
- recommendation groups start from `2026-08-10` by default via `nextWorkingDay`
- recommendation `effective_to` uses project end date or overlap cap unless future assignment confirmation is missing
- overbook source returns top-3 / top-2 / top-1 correctly

6. Rendering tests
- HTML/PDF contains planning period
- HTML/PDF does not present W1..W6 as recommendation groups

### Exit criteria

- tests fail if recommendation collapses back to weekly logic

---

## Suggested implementation order

Use this exact order to minimize churn.

1. Add contracts and decision-lock rule extensions
2. Load missing evidence fields
3. Implement `nextWorkingDay()` and RA segmentation
4. Do minimum fixture refresh
5. Build opportunities
6. Build candidate slots and hard filters
7. Refactor ranking to opportunity-based top-3
8. Update rendering and persistence
9. Do full fixture refresh and expected outputs
10. Add integration tests last

This order avoids rewriting tests twice.

---

## Concrete code touchpoints

### Existing files likely to refactor

- [generate.ts](../../packages/pmo/src/backend/reporting/recommendations/generate.ts)
- [candidate-pool.ts](../../packages/pmo/src/backend/reporting/recommendations/candidate-pool.ts)
- [capacity-simulation.ts](../../packages/pmo/src/backend/reporting/recommendations/capacity-simulation.ts)
- [contracts.ts](../../packages/pmo/src/backend/reporting/recommendations/contracts.ts)
- [load-evidence.ts](../../packages/pmo/src/backend/reporting/recommendations/load-evidence.ts)
- [project-context.ts](../../packages/pmo/src/backend/reporting/recommendations/project-context.ts)
- [rank.ts](../../packages/pmo/src/backend/reporting/recommendations/rank.ts)
- [task-similarity.ts](../../packages/pmo/src/backend/reporting/recommendations/task-similarity.ts)
- [rules/schema.ts](../../packages/pmo/src/backend/reporting/rules/schema.ts)
- [render-report-html.ts](../../packages/pmo/src/backend/reporting/render/render-report-html.ts)

### New files likely needed

```text
packages/pmo/src/backend/reporting/recommendations/recommendation-window.ts
packages/pmo/src/backend/reporting/recommendations/ra-segmentation.ts
packages/pmo/src/backend/reporting/recommendations/opportunities.ts
packages/pmo/src/backend/reporting/recommendations/candidate-slots.ts
packages/pmo/src/backend/reporting/recommendations/risk-gates.ts
packages/pmo/src/backend/reporting/recommendations/role-compatibility.ts
```

---

## Default business settings to implement first

These defaults should be the first production behavior unless PMO asks otherwise.

- planning start: `nextWorkingDay(evidenceTo + 1 day)`
- official overbook recommendation threshold: `>= 1.20 RA`
- warning band: `1.11 - 1.19 RA`
- source target busy rate after relief: `1.00`
- candidate soft ceiling after transfer: `1.00`
- candidate hard ceiling after transfer: `1.05`
- allow partial relief: `true`
- workbook `DS01.End_date` semantics: `evidence_coverage_until_confirmed`
- top candidates per opportunity: `3`
- embeddings: optional, history-only, never a hard requirement

---

## Acceptance checklist

The refactor is complete when all are true.

- [ ] Recommendation no longer iterates `member-week facts` as the primary decision grain
- [ ] Official overbook opportunities come from RA-based active-period detection
- [ ] Recommendation output starts at `nextWorkingDay(evidenceTo + 1 day)`
- [ ] Recommendation output includes `effective_from` and `effective_to`
- [ ] Decision-lock behavior for weekend start, `>= 1.20`, ceiling semantics, allocation-end semantics, and partial relief is encoded in config or contracts
- [ ] Timesheet is used as a risk validator, not the primary overbook detector
- [ ] Candidate eligibility is filtered before ranking
- [ ] Each overbook opportunity returns top-3 candidates when available
- [ ] Missing embeddings degrade confidence but do not disable deterministic recommendation
- [ ] PMO_02 fake data supports stable ranking and rejection scenarios
- [ ] HTML/PDF wording frames recommendations as future actions, not historical week edits

---

## Implementation note

Do not mutate current analytics semantics in the same PR as the recommendation refactor unless required by the new contract. Keep analytics facts and recommendation refactor separable so failures are attributable.
