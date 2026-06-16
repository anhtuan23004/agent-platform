# PMO Phase 2 Dynamic Runtime Implementation Plan

Last updated: 2025-02-14

## 1. Goal

Phase 2 changes PMO ingestion from:

- planner-driven display + static runtime execution

into:

- planner-driven execution blueprint + metadata-driven PMO UI + dynamic step progression

The target outcome is:

1. The approved planner output becomes the execution contract.
2. The workflow runtime no longer assumes a fixed order of `detect -> confirmMapping -> normalizeToStaging -> reviewChanges`.
3. Every review gate in PMO is attached to the planner step that produced it.
4. PMO page becomes the stable UI surface for step review and state progression, while backend runtime remains the single execution authority.

This plan assumes Phase 1 metadata alignment already exists or is merged first.

## 2. Current Reality

The current codebase still executes a fixed workflow:

- `packages/pmo/src/backend/workflows/ingest-data/spec.ts`
- workflow id: `pmo.ingestData`
- hardcoded runtime steps:
  - `pmo.ingest.detect`
  - `pmo.ingest.confirmMapping`
  - `pmo.ingest.normalizeToStaging`
  - `pmo.ingest.reviewChanges`

The planner already stores dynamic steps in:

- `packages/pmo/src/backend/planning/generate-plan.ts`
- `packages/pmo/src/backend/planning/plan-schema.ts`
- persisted at `ingestionSessions.planning_plan`

Phase 1 adds metadata like:

- `planner_step_id`
- `action_id`
- `review_type`

but execution is still static.

## 3. Phase 2 Target Architecture

Phase 2 should introduce a new runtime path:

- new workflow id: `pmo.ingestData.v2`
- execution model: generic orchestrator
- step handlers selected by `action_id`
- review gates selected by `review_type`

High-level runtime model:

1. Load approved planner blueprint from `planning_plan.proposed_workflow`.
2. Normalize planner steps into a runtime-safe blueprint.
3. Execute one planner step at a time using a handler registry.
4. Persist output, transition state, and next step pointer after each step.
5. If a step requires PMO review, suspend with planner-step-linked approval payload.
6. On resume, continue from the suspended planner step, not from a hardcoded runtime node.

This should coexist with legacy `pmo.ingestData` until migration is complete.

## 4. Design Principles

### 4.1 Keep runtime ids stable and machine-readable

Planner must emit or be normalized into:

```json
{
  "step_no": 3,
  "planner_step_id": "pmo.planner.step.3.normalize_to_staging",
  "action_id": "normalize_to_staging",
  "review_type": "normalization",
  "requires_user_review": true
}
```

### 4.2 Split execution from rendering

- backend owns execution order, state persistence, suspend/resume
- PMO page renders review panels using `review_type`
- workflow run page graph reads planner execution state, not synthetic guesses

### 4.3 Preserve backward compatibility

- existing runs on `pmo.ingestData` continue to work
- new sessions can opt into `pmo.ingestData.v2`
- decorator logic stays available for legacy graph rendering until old runs age out

## 5. Step-by-Step Implementation Plan

### Step 1: Finalize the executable planner contract

### Objective

Make planner output usable as an execution blueprint instead of descriptive text only.

### Files to change

- `packages/pmo/src/backend/planning/plan-schema.ts`
- `packages/pmo/src/backend/planning/generate-plan.ts`
- `packages/pmo/src/backend/planning/step-metadata.ts`
- `apps/web/src/modules/pmo/api/client.ts`

### Logic changes

1. Extend planner step schema with runtime-safe fields:
   - `planner_step_id`
   - `action_id`
   - `review_type`
   - optional `step_config`
   - optional `depends_on`

2. Add `step_config` for handler-specific execution options.

Example:

```json
{
  "action_id": "normalize_to_staging",
  "step_config": {
    "check_duplicates": true,
    "check_member_master_references": true,
    "require_db_reference_lookup": true
  }
}
```

3. Add a planner blueprint normalizer:
   - fills missing metadata for legacy or weak LLM output
   - validates `action_id`
   - validates `review_type`
   - validates dependency order

4. Reject or auto-correct planner outputs that are not executable.

### Done when

- approved plan is guaranteed to contain execution-safe metadata
- frontend and backend can trust planner metadata without regex fallback for new runs

### Step 2: Introduce a generic step registry

### Objective

Replace hardcoded `.then(stepA).then(stepB)` behavior with `action_id -> handler`.

### Files to add

- `packages/pmo/src/backend/workflows/ingest-data-v2/step-registry.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/types.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/context.ts`

### Files to reuse or adapt

- `packages/pmo/src/backend/ingestion/detect-schema.ts`
- `packages/pmo/src/backend/ingestion/normalize-rows.ts`
- `packages/pmo/src/backend/ingestion/stage-changes.ts`
- `packages/pmo/src/backend/ingestion/publish-upsert.ts`
- `packages/pmo/src/backend/workflows/ingest-data/cards.ts`

### Logic changes

Define a common handler contract:

```ts
interface PmoDynamicStepHandler {
  actionId: PmoPlanActionId;
  execute(args: ExecutePlannerStepArgs): Promise<ExecutePlannerStepResult>;
}
```

Each handler should:

1. Read prior step outputs from runtime context.
2. Perform its domain work.
3. Return:
   - `output`
   - `status`
   - `reviewRequest` if suspension is needed
   - `statePatch`

Initial handlers:

- `workbook_profiling`
- `column_mapping`
- `normalize_to_staging`
- `database_change_summary`
- `publish_after_approval`
- `generic_review` as controlled fallback

### Done when

- every planner `action_id` has a concrete backend handler
- runtime no longer needs to infer work from step position

### Step 3: Create `pmo.ingestData.v2` orchestrator workflow

### Objective

Create a new workflow that executes planner steps dynamically.

### Files to add

- `packages/pmo/src/backend/workflows/ingest-data-v2/spec.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/orchestrator.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/schemas.ts`

### Files to update

- `packages/pmo/src/backend/workflows/index.ts`
- `packages/pmo/src/backend/workflows/start-ingest.ts`

### Logic changes

The orchestrator should:

1. Load session by `ingestionSessionId`.
2. Read approved planner blueprint.
3. Read persisted `workflow_execution_state`.
4. Determine current planner step by `current_planner_step_id`.
5. Resolve handler from registry.
6. Execute handler.
7. Persist result.
8. If handler asks for review:
   - suspend with approval card
   - include `planner_step_id`, `action_id`, `review_type`
9. If handler completes:
   - mark step completed
   - select next planner step
   - loop until:
     - next review gate
     - terminal step
     - failure

Suggested workflow shape:

```ts
createWorkflow({ id: 'pmo.ingestData.v2' })
  .then(runPlannerOrchestratorStep)
  .commit();
```

The single workflow step contains the planner loop; the planner blueprint defines internal progression.

### Done when

- the new workflow can execute a 3-step or 5-step plan without code changes

### Step 4: Redesign execution state for planner-native runtime

### Objective

Persist execution by planner step, not by static runtime step id.

### Files to update

- `packages/pmo/src/backend/profiling/workbook-profiling.ts`
- `packages/pmo/src/backend/workflows/ingest-data/runtime-execution-state.ts`
- `packages/pmo/src/backend/http/routes.ts`
- `apps/web/src/modules/pmo/api/client.ts`
- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`

### Logic changes

Introduce a v2 execution state shape:

```ts
interface PlannerExecutionState {
  state_version: 2;
  current_step_no: number;
  current_planner_step_id: string;
  current_step_status: 'in_progress' | 'needs_review' | 'completed' | 'failed' | 'cancelled';
  steps: Array<{
    step_no: number;
    planner_step_id: string;
    action_id: string;
    review_type: string;
    step_name: string;
    status: string;
    output_summary?: Record<string, unknown>;
    review_status?: 'not_needed' | 'pending' | 'approved' | 'rejected' | 'modified';
  }>;
}
```

Important behavior:

1. Never infer step mapping by regex for v2 runs.
2. `current_planner_step_id` is the source of truth.
3. `step_no` remains for display ordering only.
4. Resume logic uses `planner_step_id`.

### Done when

- state transitions are planner-native
- web no longer depends on `step_no === 2/3/4` for new runs

### Step 5: Generalize approval cards and resume payloads

### Objective

Allow any planner step to suspend for review using one generic contract.

### Files to update

- `sdks/agent/src/hitl/card.ts`
- `packages/pmo/src/backend/workflows/ingest-data/cards.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/schemas.ts`
- `packages/agent/src/backend/domain/decide-approval.ts`
- `packages/agent/src/backend/routes/workflows.ts`
- `apps/web/src/modules/pmo/api/workflow-runtime.ts`

### Logic changes

Standardize PMO approval card metadata:

```ts
meta: {
  tenantId,
  userId,
  toolId,
  plannerStepId,
  actionId,
  reviewType,
  ts
}
```

Standardize PMO resume payload:

```ts
{
  decision: 'approve' | 'reject' | 'modify',
  plannerStepId: string,
  payloadPatch?: Record<string, unknown>
}
```

`modify` should support:

- mapping overrides
- normalization supplements such as member master additions
- publish-stage issue resolution if later needed

### Done when

- suspend/resume does not depend on step-specific endpoint logic
- PMO approvals are routable by metadata alone

### Step 6: Convert normalization into a handler-driven review checkpoint

### Objective

Make normalization behavior depend on planner blueprint, not fixed runtime sequencing.

### Files to refactor

- `packages/pmo/src/backend/workflows/ingest-data/spec.ts`
- extract reusable logic into:
  - `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/normalize-to-staging.ts`
  - `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/database-change-summary.ts`

### Logic changes

Split current `normalizeToStaging` behavior into two conceptual layers:

1. Normalization + validation
2. Change summary / readiness / downstream decision prep

This matters because planner may want:

- normalization review as its own step
- database comparison as a separate step
- readiness summary before publish

Normalization handler should:

1. Parse workbook with confirmed mapping.
2. Normalize rows.
3. Run required checks:
   - parse errors
   - missing required values
   - duplicate-in-upload policy
   - member/project reference lookup
4. Return planner-linked review card when `requires_user_review` is true.

### Done when

- normalization can exist as an isolated planner step without forcing publish review semantics

### Step 7: Separate database comparison from publish

### Objective

Model "compare data" and "publish data" as different planner actions.

### Files to refactor

- `packages/pmo/src/backend/workflows/ingest-data/spec.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/database-change-summary.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/publish-after-approval.ts`

### Logic changes

Current `reviewChanges` step mixes:

- review summary generation
- approval gate
- publish execution

Phase 2 should split that into:

1. `database_change_summary`
   - compute summary
   - decide if review is needed
   - suspend if needed

2. `publish_after_approval`
   - run only after summary step is approved or not needed
   - perform `publishUpsert`

This gives planner freedom to:

- stop at summary
- insert another checkpoint before publish
- omit publish from a validation-only plan

### Done when

- publish can be absent from a planner blueprint without breaking runtime

### Step 8: Make PMO frontend fully metadata-driven for v2 runs

### Objective

Render PMO workflow state and review panels from planner metadata only.

### Files to update

- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`
- `apps/web/src/modules/pmo/pages/pmo-page.tsx`
- `apps/web/src/modules/pmo/hooks/use-pmo-workflow-runtime.ts`
- `apps/web/src/modules/pmo/hooks/use-pmo-mapping-review-actions.ts`
- `apps/web/src/modules/pmo/hooks/use-pmo-normalization-review-actions.ts`
- `apps/web/src/modules/pmo/hooks/use-pmo-publish-review-actions.ts`
- `apps/web/src/modules/pmo/components/pmo-execution-step-card.tsx`
- `apps/web/src/modules/pmo/components/pmo-plan-section.tsx`

### Logic changes

1. Use `planner_step_id` as the unique key for active step matching.
2. Use `review_type` to choose panel:
   - `mapping` -> mapping panel
   - `normalization` -> normalization panel
   - `publish` -> publish panel
   - `generic` -> generic future panel or placeholder
3. Use `action_id` for label and fallback semantics.
4. Remove step-number assumptions for v2 runs.
5. Keep regex fallback only for legacy `pmo.ingestData` runs.

### Done when

- changing planner step order does not require frontend code changes

### Step 9: Update workflow graph and snapshot logic for v2

### Objective

Make run-page graph reflect actual planner execution, not projection heuristics.

### Files to update

- `packages/pmo/src/backend/workflows/planner-snapshot-decorator.ts`
- `packages/agent/src/backend/domain/get-workflow-run-snapshot.ts` if needed
- `apps/web/src/modules/agent/workflows/pages/workflow-run-page.tsx` only if snapshot shape changes

### Logic changes

For `pmo.ingestData.v2`:

1. Graph nodes come directly from planner steps.
2. Graph status comes from `workflow_execution_state.steps`.
3. No keyword mapping is needed for v2.
4. Decorator should distinguish:
   - legacy `pmo.ingestData`
   - dynamic `pmo.ingestData.v2`

### Done when

- workflow graph accurately reflects planner-native runtime state

### Step 10: Add migration and start-path selection

### Objective

Roll out Phase 2 without breaking existing PMO runs.

### Files to update

- `packages/pmo/src/backend/workflows/start-ingest.ts`
- `packages/pmo/src/backend/http/routes.ts`
- `packages/pmo/src/backend/workflows/index.ts`

### Logic changes

Add workflow start selection:

1. Existing sessions or legacy feature flag off:
   - start `pmo.ingestData`

2. New sessions with Phase 2 enabled:
   - start `pmo.ingestData.v2`

Recommended flags:

- `PMO_DYNAMIC_RUNTIME_V2`
- `PMO_DYNAMIC_RUNTIME_V2_TENANTS`

Also persist workflow flavor on session:

- `workflow_runtime_version: 'v1' | 'v2'`

### Done when

- team can run both versions side by side in staging and production

### Step 11: Expand test coverage for planner-native execution

### Objective

Protect the new execution model from regressions.

### Files to add or update

- `packages/pmo/tests/unit/workflows/ingest-data-v2/*.test.ts`
- `packages/pmo/tests/integration/*dynamic-runtime*.test.ts`
- `apps/web/tests/unit/modules/pmo/pages/pmo-page.test.tsx`
- `packages/agent/tests/integration/*workflow*.test.ts` if snapshot behavior changes

### Required test scenarios

1. Plan with 3 steps:
   - profiling
   - mapping
   - normalization

2. Plan with 5 steps:
   - profiling
   - mapping
   - normalization
   - database summary
   - publish

3. Normalization gate with missing member master rows.
4. Validation-only plan with no publish step.
5. Resume from mapping `modify`.
6. Resume from normalization `modify`.
7. Cancel mid-run.
8. Rerun and replay behavior.
9. Legacy v1 runs still render correctly.

### Done when

- planner order changes are covered by tests without code rewrites

### Step 12: Rollout strategy

### Objective

Ship safely with observability and rollback.

### Operational steps

1. Merge Phase 2 behind a feature flag.
2. Enable for local/dev first.
3. Enable for staging with controlled sessions.
4. Verify:
   - start path
   - suspend/resume
   - PMO page step alignment
   - workflow graph status
   - publish blocking rules
5. Enable for one tenant pilot.
6. Keep v1 path until:
   - no active v1 runs remain
   - no v1-only bugs remain open

### Metrics to watch

- workflow run success/failure
- suspend/resume failure rate
- mismatched approval-to-step incidents
- publish rejection rate
- runtime state desync between PMO page and workflow page

## 6. File Inventory Summary

### New files

- `packages/pmo/src/backend/workflows/ingest-data-v2/spec.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/orchestrator.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/schemas.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/types.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/context.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/step-registry.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/workbook-profiling.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/column-mapping.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/normalize-to-staging.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/database-change-summary.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/publish-after-approval.ts`

### Existing files that must change

- `packages/pmo/src/backend/planning/plan-schema.ts`
- `packages/pmo/src/backend/planning/generate-plan.ts`
- `packages/pmo/src/backend/planning/step-metadata.ts`
- `packages/pmo/src/backend/workflows/index.ts`
- `packages/pmo/src/backend/workflows/start-ingest.ts`
- `packages/pmo/src/backend/workflows/ingest-data/cards.ts`
- `packages/pmo/src/backend/workflows/ingest-data/spec.ts`
- `packages/pmo/src/backend/workflows/ingest-data/runtime-execution-state.ts`
- `packages/pmo/src/backend/profiling/workbook-profiling.ts`
- `packages/pmo/src/backend/http/routes.ts`
- `packages/pmo/src/backend/workflows/planner-snapshot-decorator.ts`
- `packages/agent/src/backend/domain/decide-approval.ts`
- `packages/agent/src/backend/routes/workflows.ts`
- `sdks/agent/src/hitl/card.ts`
- `apps/web/src/modules/pmo/api/client.ts`
- `apps/web/src/modules/pmo/api/workflow-runtime.ts`
- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`
- `apps/web/src/modules/pmo/pages/pmo-page.tsx`
- `apps/web/src/modules/pmo/hooks/use-pmo-workflow-runtime.ts`
- `apps/web/src/modules/pmo/components/pmo-execution-step-card.tsx`

## 7. Suggested Delivery Order

Implement in this order to keep the system stable:

1. executable planner contract
2. step registry
3. v2 orchestrator
4. planner-native execution state
5. generic approval metadata and resume contract
6. normalization and database-summary handler split
7. frontend metadata-only matching for v2
8. graph and snapshot support
9. rollout switch and migration path
10. integration and e2e hardening

## 8. Explicit Non-Goals for Phase 2

These should not be mixed into the same effort unless necessary:

- redesigning canonical PMO schema
- replacing PMO page visual design
- removing legacy v1 runtime immediately
- changing non-PMO workflow infrastructure globally
- introducing per-plan compiled workflow ids

## 9. Success Criteria

Phase 2 is complete when all of the following are true:

1. A planner can emit 3, 4, or 5 steps and runtime executes exactly that order.
2. Mapping, normalization, and publish reviews are attached to planner steps by metadata, not guessed by position.
3. PMO page and workflow run page show the same current step for v2 runs.
4. Resume after approval or modify continues from the suspended planner step.
5. Publish is optional in the blueprint and not implicitly forced by runtime.
6. Legacy v1 runs still work during rollout.
