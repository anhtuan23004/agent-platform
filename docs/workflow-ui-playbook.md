# Workflow + UI Playbook

This guide captures what we learned while investigating the PMO ingestion workflow and provides a repeatable, production-safe path to add a new workflow with UI support.

It complements:
- [architecture.md](./architecture.md)
- [agent-architecture.md](./agent-architecture.md)
- [creating-modules.md](./creating-modules.md)

## 1) Investigation Findings (PMO case)

### 1.1 What is already in place

- PMO workflow spec exists and is registered with the agent registry:
  - [packages/pmo/src/backend/workflows/ingest-data/spec.ts](../packages/pmo/src/backend/workflows/ingest-data/spec.ts)
  - [packages/pmo/src/backend/agent-tools/register.ts](../packages/pmo/src/backend/agent-tools/register.ts)
- PMO module is mounted and routes exist:
  - [packages/pmo/src/register.ts](../packages/pmo/src/register.ts)
  - [packages/pmo/src/backend/http/routes.ts](../packages/pmo/src/backend/http/routes.ts)

### 1.2 Why "needs review" did not render as expected

Root cause: PMO HITL suspend payload is a custom shape, not the shared ApprovalCard contract used by the generic workflow UI.

- PMO custom suspend schemas:
  - [packages/pmo/src/backend/workflows/ingest-data/schemas.ts](../packages/pmo/src/backend/workflows/ingest-data/schemas.ts)
- Generic workflow HITL host expects renderable ApprovalCard fields and drops non-conforming payloads:
  - [apps/web/src/modules/agent/workflows/components/hitl-card-host.tsx](../apps/web/src/modules/agent/workflows/components/hitl-card-host.tsx)
- Shared ApprovalCard contract:
  - [sdks/agent/src/hitl/card.ts](../sdks/agent/src/hitl/card.ts)

### 1.3 Why generic decide/resume is brittle with custom PMO payload

Generic decide logic maps decision to resume data from ApprovalCard argsPatch.

- Decision mapping path:
  - [packages/agent/src/backend/domain/decide-approval.ts](../packages/agent/src/backend/domain/decide-approval.ts)
- Generic decide API shape:
  - [packages/agent/src/backend/routes/workflows.ts](../packages/agent/src/backend/routes/workflows.ts)
  - [apps/web/src/modules/agent/workflows/api/workflows.ts](../apps/web/src/modules/agent/workflows/api/workflows.ts)

If a workflow needs complex custom modifications (example: editing full mapping tables), it must either:
- encode choices through ApprovalCard argsPatch, or
- provide a dedicated module-specific decide/resume endpoint + custom UI renderer.

### 1.4 Why there is no PMO trigger on the current UI

- PMO page is scaffold-only placeholder:
  - [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx)
- PMO upload routes currently do not start the workflow yet (TODO markers):
  - [packages/pmo/src/backend/http/routes.ts](../packages/pmo/src/backend/http/routes.ts)
- Helper exists but is not wired:
  - [packages/pmo/src/backend/workflows/start-ingest.ts](../packages/pmo/src/backend/workflows/start-ingest.ts)

## 2) Golden Path: Add a New Evented Workflow

Use this path for module workflows that must appear in Agent Workflows and support inbox/run-page HITL.

### Step 1: Define typed schemas first

Create input/output/resume types with zod.

Place near workflow implementation, for example:
- [packages/planner/src/backend/workflows/assign-by-skill/schemas.ts](../packages/planner/src/backend/workflows/assign-by-skill/schemas.ts)

### Step 2: Use evented workflow engine

Always use evented createWorkflow for durable run projection and lifecycle events.

Reference patterns:
- [packages/planner/src/backend/workflows/assign-by-skill/spec.ts](../packages/planner/src/backend/workflows/assign-by-skill/spec.ts)
- [packages/planner/src/backend/workflows/dedup-on-create/spec.ts](../packages/planner/src/backend/workflows/dedup-on-create/spec.ts)

### Step 3: For HITL, suspend with ApprovalCardSchema

Use:
- suspendSchema: ApprovalCardSchema
- resumeSchema: your typed decision schema
- suspend(payload) where payload conforms to ApprovalCard

ApprovalCard fields must include primary/decline/details/meta and argsPatch values for decision mapping.

### Step 4: Register workflow in both places

1. Module contribution (runtime availability):
- [packages/pmo/src/register.ts](../packages/pmo/src/register.ts)

2. AgentRegistry workflow spec (definitions UI / workflow metadata):
- [packages/pmo/src/backend/agent-tools/register.ts](../packages/pmo/src/backend/agent-tools/register.ts)

Both are needed.

### Step 5: Start runs through the shared start endpoint

Preferred route:
- POST /api/agent/v1/workflows/runs/:workflowId/start
- Implemented at [packages/agent/src/backend/routes/workflows.ts](../packages/agent/src/backend/routes/workflows.ts)

Why preferred:
- Seeds projection row immediately
- Applies consistent requestContext and permission model
- Supports dedupeKey if declared

### Step 6: Keep step-critical data in step schemas, not only requestContext

requestContext is useful for actor/session metadata, but business-critical fields (file keys, period ids, source ids) should flow through step input/output schemas.

This avoids hidden coupling and replay/start path inconsistencies.

### Step 7: Verify lifecycle projection and approvals

Projection and approval rows are handled by lifecycle hook:
- [packages/agent/src/backend/workflows/_infra/lifecycle-hook.ts](../packages/agent/src/backend/workflows/_infra/lifecycle-hook.ts)

Pending approvals are fetched by approver user id:
- [packages/agent/src/backend/domain/list-my-pending-approvals.ts](../packages/agent/src/backend/domain/list-my-pending-approvals.ts)

## 3) Golden Path: Build UI for a New Workflow

### Step 1: Add a trigger in your module page

Example PMO target page:
- [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx)

Typical trigger flow:
1. gather user inputs (file upload or entity id)
2. call workflow start API
3. navigate to run details page

### Step 2: Add a web API hook for start

Pattern examples:
- [apps/web/src/modules/planner/api/start-assign-by-skill.ts](../apps/web/src/modules/planner/api/start-assign-by-skill.ts)
- [apps/web/src/modules/planner/api/start-dedup-on-create.ts](../apps/web/src/modules/planner/api/start-dedup-on-create.ts)

### Step 3: Navigate to the run page after start

Route:
- [apps/web/src/routes/_authed/agent/workflows/runs/$runId.tsx](../apps/web/src/routes/_authed/agent/workflows/runs/$runId.tsx)

Run page component:
- [apps/web/src/modules/agent/workflows/pages/workflow-run-page.tsx](../apps/web/src/modules/agent/workflows/pages/workflow-run-page.tsx)

### Step 4: Reuse generic HITL renderer by default

If your suspend payload follows ApprovalCardSchema, generic UI works out of the box:
- [apps/web/src/modules/agent/workflows/components/hitl-card-host.tsx](../apps/web/src/modules/agent/workflows/components/hitl-card-host.tsx)

Decision routing:
- evented workflow approvals -> /workflows/approvals/:id/decide
- agentic chat approvals -> /chat/resume
- [apps/web/src/modules/agent/workflows/hooks/use-submit-decision.ts](../apps/web/src/modules/agent/workflows/hooks/use-submit-decision.ts)

### Step 5: Add custom renderer only when truly needed

Only create module-specific renderers when ApprovalCard blocks are insufficient.

If you do this, also define:
- explicit payload schema contract
- explicit decide/resume API contract
- integration tests for both UI and backend mapping

## 4) Common Failure Modes and How to Avoid Them

1. Custom suspend payload with no ApprovalCard fields.
- Symptom: card not shown or non-actionable fallback.
- Fix: use ApprovalCardSchema or add custom renderer + API.

2. Route says "workflow started" but does not actually start anything.
- Symptom: no run row, no approvals.
- Fix: call shared start endpoint or wire createRun/start in route.

3. Workflow data depends on requestContext-only values.
- Symptom: replay/start path inconsistencies.
- Fix: carry required data through typed step schemas.

4. Workflow registered in only one place.
- Symptom: not visible in definitions UI or not executable at runtime.
- Fix: register in module contribution and AgentRegistry workflow spec.

## 5) Delivery Checklist (Copy/Paste)

- [ ] Input/output/resume schemas are typed and validated
- [ ] Workflow uses evented createWorkflow
- [ ] HITL suspend payload conforms to ApprovalCardSchema
- [ ] WorkflowSpec is registered in AgentRegistry
- [ ] Module contribution includes workflow
- [ ] UI trigger exists in module page
- [ ] Web hook starts workflow via shared start endpoint
- [ ] Success path navigates to /agent/workflows/runs/:runId
- [ ] Approval decision path tested (approve/reject and optional modify)
- [ ] Integration tests cover run projection + pending approval visibility

---

If you start from PMO, apply this playbook in this order:
1. wire real workflow start from PMO upload flow
2. move PMO HITL payloads to ApprovalCard contract (or add custom decide/render path)
3. add PMO page trigger + run-page navigation
4. only then add richer mapping-edit UX if still required