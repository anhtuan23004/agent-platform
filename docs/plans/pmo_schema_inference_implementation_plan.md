# PMO Schema Inference - Corrected Implementation Plan

Last updated: 2026-06-13

## 1. Purpose

This document is the corrected implementation plan for PMO workbook ingestion.
It replaces earlier planning assumptions that are now outdated or inconsistent
with the real codebase.

Primary objective:
- Ingest PMO workbook data safely through a deterministic pipeline.
- Require explicit human confirmation at the right points.
- Prevent bad writes to canonical tables.
- Keep workflow resume behavior deterministic.

## 2. Inputs Reviewed

This plan is aligned after reviewing all files under docs/plans:
- docs/plans/pmo_02_ra_timesheet_schema.md
- docs/plans/pmo_plan_claude.md
- docs/plans/pmo_plan_codex.md
- docs/plans/pmo_schema_inference_plan.md
- docs/plans/pmo_schema_inference_implementation_plan.md (previous version)

And cross-checked against current implementation in:
- packages/pmo/src/backend/**
- apps/web/src/modules/pmo/**
- apps/web/src/modules/agent/workflows/**

## 3. Corrections to Previous Plan

The previous implementation plan had drift and contradictions. The following are corrected:

1. Canonical scope is 8 business/reference tables, not 5.
2. Required fields for DS04, DS06, and REF_KPI_Norms were partially wrong in older text.
3. Mapping decision contract in code is approve/reject only (no modify branch currently).
4. Suspend payload contract now uses ApprovalCardSchema for both review gates.
5. Publish gating is not only duplicate_in_upload; it now also blocks on blockingIssues.
6. publish-upsert is no longer placeholder SQL; it is typed per table with required-field guards.
7. PMO run-page approvals now render through generic card host for PMO cards to show details.
8. Workflow contribution ID is pmo.ingestData, while workflow spec domain is currently work.
9. Ingestion status lifecycle is modeled in domain but not fully persisted yet (gap, listed below).

## 4. Canonical Data Contract (Authoritative)

Source of truth remains docs/plans/pmo_02_ra_timesheet_schema.md and
packages/pmo/src/backend/ingestion/canonical-schema.ts.

### 4.1 Tables in Scope

- resource_allocation
- timesheet
- overbook_idle_config
- leave
- project_master
- member_master
- calendar_weeks
- kpi_norms

Excluded from ingestion:
- LEGEND & SUMMARY
- Answer_Key

Special header rule:
- DS05_Project_Master and DS06_Member_Master may have note row at row 1.

### 4.2 Required Fields (Current)

- resource_allocation: member_id, project_id, allocation_pct, start_date, end_date
- timesheet: member_id, work_date, logged_hours
- leave: leave_date, leave_type
- member_master: member_id, full_name
- project_master: project_id, project_name
- overbook_idle_config: config_id, rule_name, overbook_threshold, idle_threshold
- calendar_weeks: week_id, week_start, week_end, working_days
- kpi_norms: norm_id, metric

## 5. Current Implementation Snapshot

Status key:
- COMPLETE: implemented and validated.
- PARTIAL: implemented but missing coverage or operational glue.
- TODO: not implemented.

### 5.1 Pipeline Core

- COMPLETE: parser, profiler, role detection, mapping, validation.
- COMPLETE: normalize-to-staging with change classification.
- COMPLETE: timesheet aggregation before duplicate policy.
- COMPLETE: publish upsert typed per table.
- COMPLETE: pre-publish required-field validation against staging rows.

### 5.2 Workflow and HITL

- COMPLETE: evented workflow with 2 HITL gates.
- COMPLETE: mapping review card (approval gate 1).
- COMPLETE: publish review card (approval gate 2).
- COMPLETE: publish gate blocks on duplicate_in_upload and blockingIssues.
- PARTIAL: mapping decision supports approve/reject only; no user-provided modify mapping path.

### 5.3 HTTP and Web Trigger

- COMPLETE: upload-url route.
- COMPLETE: upload-complete route returning canonical start payload.
- COMPLETE: multipart upload proxy route.
- COMPLETE: PMO page uploads file and starts pmo.ingestData workflow.
- COMPLETE: run page routes PMO approvals to generic card host for details rendering.

### 5.4 Testing

- COMPLETE: unit/integration coverage for schema detection and normalization path.
- COMPLETE: unit coverage for publish validation and review gate helper.
- COMPLETE: unit coverage for PMO review card payload details.
- PARTIAL: no end-to-end workflow suspend/resume integration test file for pmo.ingestData run lifecycle.

### 5.5 Platform Integration

- COMPLETE: PMO module registered in server boot.
- COMPLETE: workflow contribution wired.
- PARTIAL: PMO events are declared but not emitted in workflow/publish paths.
- PARTIAL: ingestion session state machine exists but not fully applied to DB status transitions.
- TODO: agent tools/specs implementation (currently empty).
- TODO: subscribers implementation (folder still .gitkeep).

## 6. Workflow Contract (Current Truth)

Workflow id:
- pmo.ingestData

Steps:
1. pmo.ingest.detect
2. pmo.ingest.confirmMapping
3. pmo.ingest.normalizeToStaging
4. pmo.ingest.reviewChanges

Suspend/Resume behavior:
- confirmMapping suspends only when validationStatus != confirmed.
- reviewChanges suspends when requiresReview = true.
- requiresReview = hasUpdates OR hasBlockingIssues.

Approve blocking rules:
- mapping approve blocked when validationStatus = blocked.
- publish approve blocked when duplicate_in_upload exists or hasBlockingIssues = true.

Card payload contract:
- Both gates use ApprovalCardSchema.
- PMO cards include detailed kvTable/text blocks.
- PMO run page renders through generic HitlCardHost path.

## 7. Data Merge and Change Classification (Current Truth)

Natural keys:
- resource_allocation: member_id + project_id + start_date + end_date
- timesheet: member_id + work_date + project_id + log_category
- leave: member_id + leave_date + leave_type
- member_master: member_id
- project_master: project_id
- overbook_idle_config: config_id
- calendar_weeks: week_id
- kpi_norms: norm_id

Change types:
- new_record
- updated_record
- exact_duplicate
- duplicate_in_upload

Duplicate policy:
- timesheet duplicates are aggregated and not blocked.
- other tables: duplicate_in_upload blocks publish approval.

Publish behavior:
- exact_duplicate and duplicate_in_upload are skipped in publishUpsert.
- new/updated rows are inserted/upserted to canonical tables.
- staging rows are deleted only after publish transaction succeeds.

## 8. Remaining Implementation Steps (Ordered)

These are the missing or weak areas that should be completed next.

### Step 1: Persist ingestion lifecycle transitions end-to-end

Why:
- ingestion_sessions.status is created as uploaded but not updated through workflow stages.

Implement:
- Add DB transition helpers using domain/ingestion-session.ts guards.
- Update status at detect/confirm/normalize/review/publish/reject/fail points.
- Persist confirmed_at, finished_at, publish_reviewed_at, publish_decision where appropriate.

Files:
- packages/pmo/src/backend/domain/ingestion-session.ts
- packages/pmo/src/backend/workflows/ingest-data/spec.ts
- packages/pmo/src/backend/http/routes.ts

Gate:
- Integration tests assert DB status transitions follow allowed graph only.

### Step 2: Emit PMO domain events from real workflow transitions

Why:
- PMO_EVENTS exists but emission is not wired.

Implement:
- Emit schema_detected after detect step.
- Emit mapping_confirmed after approve in confirmMapping.
- Emit staging_complete after normalizeToStaging.
- Emit publish_approved and data_published around successful publish.
- Emit ingestion.failed on controlled failure paths.

Files:
- packages/pmo/src/events.ts
- packages/pmo/src/backend/workflows/ingest-data/spec.ts

Gate:
- Integration tests verify outbox rows/events for each milestone.

### Step 3: Add workflow suspend/resume integration tests

Why:
- Current tests cover functions and cards well, but not full workflow run behavior.

Implement tests for:
- detect -> suspend confirmMapping -> resume approve -> normalize -> publish
- detect blocked -> suspend with allowApprove=false -> forced approve fails
- normalize with updates -> suspend reviewChanges -> approve -> publish
- reviewChanges blocked by duplicate_in_upload or blockingIssues

Files:
- packages/pmo/tests/integration/workflow-ingest.test.ts (new)

Gate:
- No step re-execution regressions across resume boundaries.

### Step 4: Close mapping modify-gap explicitly

Why:
- Older docs mention approve/modify/reject, but current contract is approve/reject.

Choose one path and document it:
1. Keep approve/reject only and remove modify from all plan docs.
2. Add modify branch properly:
   - resume schema with modified mapping payload
   - validation and security checks for modified mapping
   - tests for modify path

Files:
- packages/pmo/src/backend/workflows/ingest-data/schemas.ts
- packages/pmo/src/backend/workflows/ingest-data/spec.ts
- apps/web/src/modules/agent/workflows/** (if custom UI needed)

Gate:
- Behavior and docs are consistent, no mixed contracts left.

### Step 5: Remove or implement dead/orphan artifacts

Why:
- There are stale pieces causing drift (for example orphan contracts warning, unused start helper).

Implement:
- Either define and export meaningful PMO contracts in src/contracts.ts or remove unused file.
- Remove or wire packages/pmo/src/backend/workflows/start-ingest.ts.

Gate:
- depcruise warning no-orphan-modules for PMO is resolved.

### Step 6: Implement PMO agent tools and specs

Why:
- register.ts wires agentTools/specs, but arrays are currently empty.

Implement minimum set:
- read tools: getIngestionStatus, listRecentSessions, previewChangeSummary
- controlled write tool: startIngestion (with approval)

Files:
- packages/pmo/src/backend/agent-tools/register.ts
- packages/pmo/src/backend/agent-specs.ts

Gate:
- Tools appear in runtime and have typed schemas + tests.

### Step 7: Expand PMO HTTP API beyond upload

Why:
- Current routes support upload and start payload only.

Implement:
- GET /api/pmo/v1/sessions/:id
- GET /api/pmo/v1/sessions?status=&period=
- GET /api/pmo/v1/change-summary/:id

Gate:
- Web UI can monitor ingestion history without querying workflow internals directly.

### Step 8: Build PMO monitoring UI pages

Why:
- Current web module has one page focused on upload trigger.

Implement:
- session list/status page
- session detail page with step timeline and change summary
- publish review read-only inspection view

Files:
- apps/web/src/modules/pmo/pages/**
- apps/web/src/modules/pmo/components/**

Gate:
- PMO operator can track ingestion lifecycle without opening raw workflow graph.

### Step 9: Subscribers and post-publish reactions

Why:
- subscribers folder is still empty.

Implement:
- listener for publish success to notify downstream dashboards
- optional notifications event bridge for publish failure/reject outcomes

Files:
- packages/pmo/src/backend/subscribers/**

Gate:
- Subscriber handlers are idempotent and covered by integration tests.

### Step 10: Final quality gates and rollout

Run:
- pnpm --filter @seta/pmo typecheck
- pnpm --filter @seta/pmo test
- pnpm --filter @seta/web typecheck
- pnpm depcruise

Acceptance:
- No drift between docs and contracts.
- No placeholder publish paths left.
- Workflow pause/resume behavior covered in integration tests.
- PMO operator UX covers upload, status, review visibility, and outcomes.

## 9. PR Slicing Recommendation

To reduce risk and review size:

PR 1:
- Step 1 + Step 2 + Step 3
- lifecycle persistence, event emission, workflow integration tests

PR 2:
- Step 4 + Step 5
- resolve modify contract, remove dead artifacts/orphan warnings

PR 3:
- Step 6 + Step 7 + Step 8
- tools + API + UI monitoring pages

PR 4:
- Step 9 + Step 10
- subscribers + final hardening

## 10. Definition of Done

Done means all are true:
- Contracts in docs and code are aligned (no stale branches).
- pmo.ingestData handles real files with deterministic gates.
- Bad data cannot slip into canonical tables through publish path.
- PMO reviewers can see actionable review details in UI.
- Resume paths are deterministic and tested.
- Events/lifecycle/monitoring are complete, not stubs.
