# PMO remediation plan

Phased plan to harden the PMO module for production. Decisions captured via grill session (2026-06-18).

**Goal:** Production-ready — security and architectural compliance first, minimal diff per phase.

**Glossary:** [`packages/pmo/CONTEXT.md`](../../packages/pmo/CONTEXT.md)

---

## Decisions log

| # | Question | Decision |
|---|----------|----------|
| 1 | Primary objective | **A — Production-ready** (RBAC → Events → Tests → Cleanup) |
| 2 | RBAC scope | **B — PMO HTTP routes + workflow HITL gate** (`pmo.ingestion.confirm`) |
| 3 | Migration | **A — Update bootstrap scripts**; default member role `pmo.operator` |
| 4 | Events | **A — Terminal only** (`data_published`, `failed`) |
| 5 | Tests | **A — Safety net for Phase 1–2** (no frontend tests yet) |
| 6 | Refactor | **B — Backend route split**, `packages/pmo` only |
| 7 | Split timing | **A — Split routes before RBAC** (Phase 0) |

---

## Phase overview

| Phase | Name | Goal | Primary scope |
|-------|------|------|---------------|
| **0** | Route split | Decompose god file before logic changes | `packages/pmo` |
| **1** | RBAC | Lock HTTP + workflow HITL | `packages/pmo` + ~30 LOC `packages/agent` |
| **2** | Events | Outbox for publish terminal events | `packages/pmo` |
| **3** | Tests | Safety net for Phase 1–2 | `packages/pmo` + 1 file `packages/agent` |
| **4** | Cleanup | Docs, nav, remove dead code | `packages/pmo` + `apps/web` manifest |

**Verify each phase:** `pnpm typecheck && pnpm lint && pnpm test`

**Delivery:** One PR per phase, merge sequentially.

**Estimated total:** ~4.5 days

---

## Phase 0 — Split `routes.ts` (move-only)

### Objective

Split `packages/pmo/src/backend/http/routes.ts` (~1897 LOC) into focused files. **No behavior changes.**

### Target structure

```text
packages/pmo/src/backend/http/
├── routes.ts                 # buildPmoRoutes() — compose only
├── _shared.ts                # helpers: asIso, formatFileSize, shared schemas
├── upload-routes.ts          # upload-url, upload-complete, upload
├── session-routes.ts         # GET ingestion-sessions, workflow/cancel
├── planning-routes.ts        # plan/generate, confirm-intent, approve
├── profiling-routes.ts       # documents/upload, profiling/review, approve-continue
└── demo-analytics-route.ts   # (already exists)
```

### Rules

- Pure move — no RBAC, no response shape changes
- Keep `normalizeProfilingSummaryForTests` export (existing test imports from `routes.ts`)
- Each file registers routes on the same `Hono<SessionEnv>` instance

### Acceptance criteria

- [ ] `routes-profiling-summary-normalization.test.ts` passes
- [ ] `pnpm depcruise` passes
- [ ] Manual smoke: upload → plan → profiling still works

**Effort:** ~0.5 day

---

## Phase 1 — RBAC enforcement

### Objective

Only users with PMO roles may upload, confirm review gates, or read PMO data.

### 1a. PMO RBAC helper

Create `packages/pmo/src/backend/rbac.ts` (pattern: `packages/planner/src/backend/rbac.ts`):

```typescript
export function requirePmoPermission(session: SessionScope, permission: PmoPermission): void
// throws PmoError with code FORBIDDEN
```

### 1b. HTTP route permission map

| Route | Permission |
|-------|------------|
| `POST /api/pmo/v1/upload-url`, `upload`, `upload-complete` | `pmo.ingestion.upload` |
| `POST /api/pmo/v1/plan/approve`, `plan/confirm-intent` | `pmo.ingestion.confirm` |
| `POST /api/pmo/v1/profiling/review`, `profiling/approve-continue` | `pmo.ingestion.confirm` |
| `POST /api/pmo/v1/ingestion-sessions/:id/documents/upload` | `pmo.ingestion.upload` |
| `POST /api/pmo/v1/workflow/cancel` | `pmo.ingestion.confirm` |
| `GET /api/pmo/v1/ingestion-sessions` | `pmo.ingestion.read` |
| `GET /api/pmo/v1/demo-analytics` | `pmo.data.read` |
| `POST /api/pmo/v1/analytics/compute-facts` | `pmo.data.read` |

### 1c. Workflow HITL gate

**Problem:** `agent.workflow.approve` is in `IMPLICIT_PERMISSIONS` — any authenticated user can approve PMO workflow cards.

**Solution (minimal agent touch):**

1. Add `approvalPermissionGuards` to `ContributionRegistry` (or extend an existing extension point).
2. PMO registers in `register.ts`:

   ```typescript
   { workflowId: 'pmo.ingestData.v2', permission: 'pmo.ingestion.confirm' }
   ```

3. `recordApprovalDecision` in `packages/agent`: after `agent.workflow.approve` check, lookup guard by `workflow_id` and enforce additional permission when registered.

Policy lives in PMO; agent is a generic dispatcher (~20–30 LOC).

Apply the same guard on `POST /chat/resume` when the approval row's workflow matches.

**ADR candidate:** "PMO workflow approvals require domain permission via guard registry" — create at start of 1c if desired.

### 1d. Bootstrap migration

| File | Change |
|------|--------|
| `scripts/tenant-bootstrap.sh` | Grant `pmo.operator` to members (after `agent.contributor`) |
| `apps/cli/src/commands/seed.ts` | Add `pmo.operator`, `pmo.viewer` to `KNOWN_ROLES`; auto-grant `pmo.operator` for CSV users with planner roles |
| `docs/dev-quickstart.md` | Document that members receive `pmo.operator` by default |

### 1e. Frontend nav gating

```typescript
// apps/web/src/modules/pmo/manifest.ts
requiredPermissions: ['pmo.ingestion.read'],
```

Hide PMO nav for users without read permission (avoid 403 after navigation).

### Acceptance criteria

- [ ] User without PMO role → 403 on upload and workflow decide
- [ ] `tenant.admin` and `pmo.operator` → full flow
- [ ] `pmo.viewer` → read only; 403 on upload/confirm
- [ ] `tenant-bootstrap.sh` members can upload immediately
- [ ] Nav hidden when missing `pmo.ingestion.read`

**Effort:** ~1.5 days

---

## Phase 2 — Terminal events (outbox)

### Objective

Emit `pmo.ingestion.data_published` and `pmo.ingestion.failed` atomically with state changes.

### 2a. `data_published`

**Emit point:** After successful `publishUpsert` in `publish-after-approval.ts` / `pmo-ingestion-adapter.publish`.

**Pattern (planner — atomic, not knowledge post-commit):**

```typescript
await withEmit({ actor: { userId, tenantId } }, async (tx) => {
  // publish upsert uses tx (refactor publishUpsert to accept tx param)
  await tx.update(ingestionSessions).set({ status: 'published', ... });
  await emit({
    tenantId,
    aggregateType: 'pmo.ingestion_session',
    aggregateId: sessionId,
    eventType: 'pmo.ingestion.data_published',
    eventVersion: 1,
    payload: { ingestion_session_id, rows_written, rows_updated },
  });
});
// ensureFactsComputed runs AFTER transaction commit
await ensureFactsComputed(tenantId, { sessionId, force: true });
```

**Refactor:** `publishUpsert` accepts optional `tx` from `withEmit` body instead of opening its own `pmoDb().transaction`.

### 2b. `failed`

**Emit point:** Orchestrator when setting `status: 'failed'`.

Payload: `{ ingestion_session_id, reason }`.

### Deferred (no subscriber yet)

- `pmo.ingestion.schema_detected`
- `pmo.ingestion.mapping_confirmed`
- `pmo.ingestion.staging_complete`
- `pmo.ingestion.publish_approved`

### Acceptance criteria

- [ ] After publish: row in `core.events` with `event_type = 'pmo.ingestion.data_published'`
- [ ] On failure: `pmo.ingestion.failed` emitted
- [ ] Event + session status in same transaction
- [ ] `ensureFactsComputed` still runs after publish (existing contract)

**Effort:** ~1 day

---

## Phase 3 — Tests (safety net)

### Objective

Cover Phase 1–2 changes only. No frontend tests in this phase.

### New test files

```text
packages/pmo/tests/unit/rbac-parity.test.ts
packages/pmo/tests/integration/http/rbac-routes.test.ts
packages/pmo/tests/integration/events/publish-emits.test.ts
packages/agent/tests/integration/rbac/pmo-workflow-approve.test.ts
```

### Test cases

| File | Cases |
|------|-------|
| `rbac-parity` | `pmoRbac` matches inventory slice |
| `rbac-routes` | No role → 403 upload; viewer → 403 confirm; operator → 200 |
| `publish-emits` | Publish pipeline → `core.events` row with correct payload |
| `pmo-workflow-approve` | Decide PMO approval without `pmo.ingestion.confirm` → 403 |

Use testcontainers Postgres per repo convention.

### Acceptance criteria

- [ ] All four test files pass
- [ ] Full `pnpm test` suite passes

**Effort:** ~1 day

---

## Phase 4 — Cleanup (PMO-scoped)

### Objective

Remove dead code and complete documentation. **Do not** split `pmo-page.logic.ts` (deferred).

### 4a. Remove stale code

| Item | Action |
|------|--------|
| `PmoPlanSection` | Delete if unreferenced |
| `PmoWorkflowExecutionSection` | Delete if unreferenced |
| `workflows/ingest-data/` (v1) | Delete if not registered; audit tests first |

Verify with `grep` before deletion.

### 4b. README

Complete `packages/pmo/README.md`:

- Domain description (ingestion + analytics)
- Events emitted (2 terminal)
- RBAC roles
- Public surface paths

### 4c. Contract doc

Update `packages/pmo/docs/analytics-compute-contract.md` — remove "not emitted yet" for `data_published`.

### Acceptance criteria

- [ ] No unused exports (`pnpm lint`, `pnpm depcruise`)
- [ ] README has no TODO placeholders
- [ ] `pnpm typecheck && pnpm lint && pnpm test`

**Effort:** ~0.5 day

---

## Deferred (out of scope)

| Item | Reason |
|------|--------|
| Split `pmo-page.logic.ts` (~1350 LOC) | Wait for frontend tests (future Phase 4b) |
| Intermediate ingestion events (4 events) | No subscribers |
| E2E Playwright for PMO | After nav gating is stable |
| Generic ingestion architecture | Separate plan: `domain_specific_ingestion_architecture_plan.md` |
| Remove `agent.workflow.approve` from implicit | System-wide breaking change |

---

## Timeline

```text
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
 0.5d        1.5d         1d          1d         0.5d
                         Total: ~4.5 days
```
