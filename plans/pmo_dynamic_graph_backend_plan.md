# PMO Dynamic Graph Backend Plan

## 1) Goal

Make the workflow graph on the run page dynamic per PMO planner steps, while preserving existing runtime stability and approval/cancel/rerun behavior.

## 2) Current Reality (from code)

- Runtime workflow is static and defined in `pmo.ingestData` with fixed steps:
  - detect
  - confirmMapping
  - normalizeToStaging
  - reviewChanges
- Current graph UI is built from `snapshot.serializedStepGraph` (not from PMO planner JSON).
- PMO planner already stores dynamic `proposed_workflow` in `pmo.ingestion_sessions.planning_plan`.
- Agent run operations (`cancel`, `rerun`, `replay`, sweeper/resume) resolve workflow via `mastra.getWorkflow(row.workflow_id)`.

Implication:
- If we only change PMO frontend cards, graph stays static.
- If we create per-run dynamic workflow IDs, we must guarantee those IDs are re-registerable after process restart.

## 3) Recommended Architecture

### Phase A (recommended now): Dynamic Graph Projection (Backend), Keep Runtime Stable

Make graph dynamic by decorating snapshot response for PMO runs only.

Design:
- Keep actual execution workflow as static `pmo.ingestData`.
- Add a backend snapshot decoration pipeline in Agent routes/domain.
- PMO module registers a decorator for `pmo.ingestData`.
- Decorator reads `ingestionSessionId` from run input, loads PMO `planning_plan.proposed_workflow`, and returns a transformed snapshot:
  - `serializedStepGraph` synthesized from planner steps
  - optional synthetic `context` entries for planner step statuses (mapped from PMO `workflow_execution_state.steps`)

Result:
- Graph becomes dynamic and aligned with planner for each session.
- No change to run lifecycle, approval semantics, retry/cancel logic.
- Low-risk, fast delivery.

Why this is architecture-safe:
- Agent package must not import feature modules directly.
- Use contribution-based decorator registration from PMO module into Agent runtime instead of cross-module imports.

### Phase B (optional later): True Dynamic Runtime by Planner

After Phase A is stable, evolve execution itself to data-driven planner flow.

Two viable sub-options:
1. Generic orchestrator workflow (`pmo.ingestData.v2`) executing a persisted step blueprint.
2. Compiled workflow per plan hash (`pmo.ingestData.plan.<hash>`) with boot-time rehydration/registration.

Recommendation:
- Prefer 1 first (generic orchestrator), because 2 adds operational complexity around dynamic ID lifecycle and restart-safe registration.

## 4) Detailed Technical Design (Phase A)

### 4.1 New backend extension point

Add a workflow snapshot decorator contribution contract:
- Input:
  - run row (`workflowId`, `inputSummary`, `tenantId`, `runId`)
  - loaded snapshot
  - infra handles (db/pool if needed)
- Output:
  - transformed snapshot

Execution point:
- In `get-workflow-run-snapshot` flow, after loading snapshot and before returning JSON.

### 4.2 PMO decorator behavior

For `workflowId === pmo.ingestData`:
- Parse `ingestionSessionId` from run input summary.
- Load session row from PMO schema.
- Read planner steps from `planning_plan.proposed_workflow`.
- Build `serializedStepGraph` list from planner steps in sorted `step_no` order.
- Build status map for each planner step:
  - primary source: `workflow_execution_state.steps`
  - fallback source: runtime context step statuses
- Inject synthetic context entries so node badges can show completed/in_progress/needs_review/cancelled.

Graph node ID strategy:
- Use deterministic IDs: `pmo.planner.step.<step_no>`
- Include planner text in node description.

### 4.3 Mapping logic (runtime -> planner)

- Preferred: step_no direct mapping when available.
- Fallback: keyword mapping for legacy sessions.
- Preserve terminal statuses (`completed`, `failed`, `cancelled`) as-is.
- If run is canceled, force non-terminal planner steps to `cancelled`.

### 4.4 Backward compatibility

- If no planner or malformed planner: return original snapshot unchanged.
- If decorator fails: log and return original snapshot (fail-open).

## 5) Concrete File-Level Change Plan

### Agent side

1. Add snapshot decorator registry/contract in agent-sdk and/or agent runtime contribution path.
2. Wire decorator execution in snapshot endpoint path:
   - `packages/agent/src/backend/domain/get-workflow-run-snapshot.ts`
3. Register decorators in boot path with existing contribution registry:
   - `packages/agent/src/register.ts`

### PMO side

1. Implement PMO snapshot decorator:
   - New file under `packages/pmo/src/backend/workflows/` (or `backend/projections/`)
2. Register PMO decorator contribution:
   - `packages/pmo/src/register.ts`

### Optional Web side (only if needed)

- No required change if snapshot contract is preserved (`serializedStepGraph` + `context`).
- Existing graph builder should render planner graph automatically.

## 6) Testing Strategy

### Unit

- Planner graph synthesis from `proposed_workflow`.
- Status mapping logic:
  - normal flow
  - paused/needs_review
  - failed
  - canceled
- Fail-open behavior when planner/session missing.

### Integration

- Start PMO run with plan A, verify run snapshot graph nodes == plan A.
- Regenerate/approve plan B for another session, verify graph nodes == plan B.
- Cancel run from workflow page, verify planner graph statuses update to cancelled.

### Regression

- Non-PMO workflows unchanged.
- Rerun/replay/cancel endpoints unchanged for PMO run IDs.

## 7) Risks and Mitigations

1. Risk: Agent package importing PMO package violates architecture boundaries.
- Mitigation: contribution/decorator registration from PMO into Agent runtime.

2. Risk: Planner step names not mappable to runtime statuses.
- Mitigation: prioritize step_no mapping, keep keyword fallback, and fail-open.

3. Risk: Snapshot decorator errors break graph page.
- Mitigation: catch/log and return original snapshot.

## 8) Rollout Plan

1. Build decorator framework (feature-flagged).
2. Implement PMO decorator behind flag `PMO_DYNAMIC_GRAPH_FROM_PLANNER`.
3. Enable in dev/staging and verify with real sessions.
4. Enable in production after run-level observability checks.

## 9) Effort Estimate

- Phase A: 2-4 working days including tests.
- Phase B (true dynamic runtime): 2-4 weeks depending on orchestrator depth and migration policy.

## 10) Decision Proposal

Approve Phase A now to deliver planner-dynamic graph quickly and safely.
Then decide Phase B after validating user behavior and planner quality in production.
