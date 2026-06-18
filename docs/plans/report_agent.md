# PMO Report Agent After Publish Plan

## Summary

Implement a planner-controlled optional `generate_report` step for PMO workflows. If the user goal asks for idle/overbook/utilization reporting, the planner adds this step after publish. The step must run only on published canonical DB data.

If the goal has an explicit date range, use it. If the goal asks for a report but has no clear range, suspend and ask the user to confirm/edit a date range, with the uploaded sheet range prefilled as the default suggestion. Do not silently use the sheet range.

## Current Tool Inventory

Existing tools:

| Tool | Exists | Meaning | Input | Output | Gap |
|---|---:|---|---|---|---|
| `pmo_computeMemberWeekFacts` | Yes | Recompute member-week utilization facts from published canonical PMO data. | `{}` | `{ factCount, memberCount, weekIds, thresholds }` | No date range input; recomputes all tenant facts. |
| `pmo_detectOverbookIdle` | Yes | Detect overbooked and idle members from persisted utilization facts. | `{}` | `{ findings: Finding[] }` | No range filter; assumes facts are already computed. |
| `pmo_detectMismatch` | Yes | Detect logged-vs-planned mismatch from persisted utilization facts. | `{}` | `{ findings: Finding[] }` | Useful later, but not required for v1 idle/overbook report. |
| `pmo.ingestData.v2` workflow | Yes | Planner-driven ingest: profile, map, normalize, DB summary/publish. | `{ ingestionSessionId, fileKey, tenantId?, reportingPeriod*? }` | `{ status, rowsWritten, rowsUpdated, rowsSkipped }` | No report action, no report range gate, no report output. |

Tools/workflows to add or extend:

| Capability | Add/Extend | Meaning | Input | Output |
|---|---|---|---|---|
| `generate_report` planner action | Add | Optional workflow step after publish. | Planner/runtime context | Report request/result checkpoint. |
| Report range resolver | Add | Extract explicit range from goal, otherwise prepare suggested sheet range and ask user. | `{ goal, ingestionSessionId, workbook/profile/staging metadata }` | `{ status: 'confirmed' | 'needs_user_input', dateRange, source }` |
| `pmo_generateReport` tool/workflow handler | Add | Generate idle/overbook report from canonical DB for confirmed range. | `{ dateRange, reportTypes, ingestionSessionId? }` | `{ reportRunId?, report, artifact? }` |
| Range-aware facts computation | Extend | Compute/filter member-week facts for a date window. | `{ from, to, sessionId? }` | `{ facts, weekIds, thresholds }` |
| Report artifact persistence | Add, phase 3 | Store generated report result for UI/follow-up. | Report run/result | `report_runs`, optional `report_artifacts`. |

## Phase 1 — Planner Contract And Runtime Skeleton

1. Extend PMO planning schema/catalog:
   - Add action id `generate_report`.
   - Add review type `report`.
   - Add intent support for report requests, either as `report_intent` or as a report option attached to `publish_intent`.
   - Update classification rules so goals containing “generate report”, “idle”, “overbook”, “utilization report”, or equivalent Vietnamese phrases can produce `generate_report`.

2. Add `generate_report` to planner step metadata:
   - `step_name`: `Generate PMO report`.
   - `requires_prior_checkpoint`: publish/database summary completed.
   - `default_requires_user_review`: false, except when date range is missing.

3. Extend runtime state types:
   - Add session statuses: `awaiting_report_range`, `generating_report`, `report_generated`.
   - Add `report_request` and `report_result` to `DynamicIngestRuntimeContext`.
   - Persist these into `ingestion_sessions.workflow_execution_state` first; defer new DB report tables until Phase 3.

4. Fix workflow terminal behavior:
   - Publish handler must not stop the whole dynamic runtime if a next planner step exists.
   - `terminalOutput` should only terminate when there is no next step, or the orchestrator should carry publish output forward and continue to `generate_report`.

5. Add an empty `generate_report` handler:
   - Resolves after publish.
   - Fails fast if canonical publish did not complete.
   - Returns a placeholder report output summary for tests before analytics integration.

## Phase 2 — Date Range Resolution And HITL Question

1. Add a report request schema:
   - `reportTypes`: `['idle_members', 'overbook_members']` by default for idle/overbook goals.
   - `dateRange`: `{ from, to, source }`.
   - `source`: `goal_explicit | user_confirmed | sheet_suggested_pending`.

2. Extract explicit date range from the planner goal:
   - Use deterministic parsing for ISO dates and simple `from ... to ...` patterns first.
   - If unresolved, rely on planner output metadata only as a hint, not as final truth.

3. Derive suggested range from the uploaded workbook:
   - Prefer `ingestion_sessions.reporting_period_start/end` when present.
   - Otherwise derive from parsed workbook canonical date fields:
     - `timesheet.work_date`
     - `resource_allocation.start_date/end_date`
     - `calendar_weeks.week_start/week_end`
   - Store this as suggestion only.

4. Add report range HITL card:
   - Trigger only when report intent exists and goal has no explicit date range.
   - Display default suggested range from the sheet.
   - Resume payload must include confirmed `{ from, to }`.
   - Reject/cancel should mark report step rejected without rolling back publish.

5. Add UI rendering:
   - Reuse existing workflow HITL card host if possible.
   - Add report range card renderer only if generic approval card cannot collect editable date inputs cleanly.

## Phase 3 — Range-Aware Analytics And Report Generation

1. Extend canonical analytics loading:
   - Add `loadCanonicalInputs(tenantId, { from, to })`.
   - Filter weeks to overlap the range.
   - Filter timesheets/leaves by date in range.
   - Filter allocations/projects/members needed to compute facts for overlapping weeks.

2. Extend fact computation:
   - Add `computeAndPersistFacts(tenantId, sessionId, { from, to })` or create a non-persisting report computation path.
   - Recommended for v1: compute report facts without deleting tenant-wide `member_week_facts`.
   - Keep existing `pmo_computeMemberWeekFacts` behavior unchanged for demo/calculation page compatibility.

3. Add report generator:
   - Input:
     ```ts
     {
       tenantId: string
       ingestionSessionId?: string
       dateRange: { from: string; to: string }
       reportTypes: Array<'idle_members' | 'overbook_members'>
     }
     ```
   - Output:
     ```ts
     {
       dateRange: { from: string; to: string }
       summary: {
         memberCount: number
         overbookCount: number
         idleCount: number
         excludedWeekCount: number
       }
       findings: Array<{
         memberId: string
         issueType: 'overbook' | 'idle'
         ragColor: 'yellow' | 'red'
         busyRate: number | null
         effortConsumption: number | null
         detail: string
         excludedWeeks: Array<{ weekId: string; reason: string }>
       }>
     }
     ```

4. Add or extend agent tool:
   - Preferred new tool: `pmo_generateReport`.
   - It should call range-aware analytics and return a report-ready object.
   - Existing `pmo_detectOverbookIdle` stays as a lower-level DB-read tool.

5. Wire handler to tool/service:
   - `generate_report` handler resolves/asks date range.
   - After range is confirmed, call report generator.
   - Store report result in runtime context and output summary.
   - Final workflow output should include report status, counts, and optional artifact id.

## Phase 4 — Persistence, UI, And Follow-Up Use

1. Add report persistence:
   - Add `pmo.report_runs` with tenant, ingestion session, report type, date range, status, created by/at.
   - Add `pmo.report_artifacts` only if report payload becomes too large for workflow state.
   - Generate migration through module CLI, not by hand-editing generated migrations.

2. Add PMO UI report card:
   - Show date range, generated-at, idle count, overbook count, and finding rows.
   - Keep it as an operational review table, not a marketing/report landing page.
   - Add download/export only after the first report card works.

3. Add report-only path later:
   - Allow user to ask “generate idle/overbook report from DB” without uploading a workbook.
   - This can become a separate `pmo.generateReport.v1` workflow once report generation is stable inside ingest flow.

## Test Plan

1. Planner/catalog tests:
   - Goal with “publish and generate idle/overbook report from 2026-06-01 to 2026-06-30” includes `generate_report`.
   - Goal with “publish and generate report” includes `generate_report` and marks range missing.
   - Goal without report intent does not include report step.

2. Runtime tests:
   - Publish completes and runtime continues to `generate_report` when it is the next step.
   - Publish remains terminal when no report step exists.
   - Missing date range suspends with suggested sheet range.
   - Confirmed range resumes and completes report generation.
   - Rejecting report range does not rollback published canonical data.

3. Analytics tests:
   - Report facts only include weeks overlapping the confirmed range.
   - Idle/overbook findings change when date range changes.
   - Holiday, leave, training, and approved OT exclusions still apply.
   - Existing no-range analytics tools continue to pass.

4. UI tests:
   - Workflow cards show `Generate PMO report` after publish when planned.
   - Date range HITL card renders default sheet range and submits edited range.
   - Report result card shows idle/overbook counts and finding rows.

## Assumptions And Defaults

- `generate_report` is optional and planner-controlled, not hard-coded inside publish.
- Report generation runs after canonical publish and reads canonical DB data only.
- If goal lacks date range, workflow must ask user; sheet range is only the default suggestion.
- V1 report types are `idle_members` and `overbook_members`; mismatch reporting can reuse the same framework later.
- V1 may store report result in workflow state; durable `report_runs` tables are Phase 4.
- Existing analytics tools are retained for compatibility, but a new range-aware report tool is preferred for the new feature.
