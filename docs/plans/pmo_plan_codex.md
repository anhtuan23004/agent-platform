# PMO Plan Codex (Canonical Schema Driven)

## Goal
Implement the PMO ingestion flow from the workbook PMO_02_RA_Timesheet_Monitoring using the canonical schema in docs/pmo_02_ra_timesheet_schema.md, with strict dependency order:
- Receive an input workbook.
- Detect sheet structure and mapping confidence.
- If mapping is not reliable, trigger clarification loop.
- User approves or modifies mapping.
- Workflow continues directly to normalize, validate, and publish.
- Do not rerun the whole flow after user confirmation.

## Canonical Scope
Production ingestion scope:
- DS01_Resource_Allocation
- DS02_Timesheet_Log
- DS03_Overbook_Idle_Config
- DS04_Leave_Holiday_Records
- DS05_Project_Master
- DS06_Member_Master
- REF_Calendar_Weeks
- REF_KPI_Norms

Special handling:
- LEGEND & SUMMARY is metadata only and must not be treated as business data.
- Answer_Key is test-evaluation data and must be excluded from production ingestion by default.
- DS05_Project_Master and DS06_Member_Master have a note row at row 1; real header starts at row 2.

## Mandatory Rules
1. Follow the step order exactly. No skipping and no reordering.
2. Each step has a transition condition (Gate). Do not continue before gate pass.
3. Clarification loop must run on evented workflow suspend/resume, not chat one-shot HITL.
4. Approve or modify must continue from normalize step, not from detect step.
5. Replay-from-step is in-place replay for current run; rerun creates a new run.

## Required State Machine
uploaded -> profiling_sheets -> awaiting_mapping_confirmation -> normalizing -> validating -> publishing -> published
uploaded -> profiling_sheets -> failed
awaiting_mapping_confirmation -> rejected
awaiting_mapping_confirmation -> normalizing (approve or modify)
normalizing -> failed
validating -> failed
publishing -> failed

## Step-by-Step Plan

### Step 1 - Freeze Canonical Data Contract
Implement:
1. Lock canonical entities and columns from docs/pmo_02_ra_timesheet_schema.md.
2. Lock field-level constraints:
   - required vs nullable
   - enum sets
   - date format and parsing policy
   - numeric precision and range policy
3. Lock relationship checks used during validation:
   - Member_ID joins
   - Project_ID joins
   - PM_ID and Line_manager_id references

Output:
- Canonical PMO contract document with version tag.
- Validation rule matrix by table/column.

Gate to Step 2:
- Product and data owners approve canonical contract without open items.

### Step 2 - Define Ingestion Boundary and Clarification Policy
Implement:
1. Define accepted file types (xlsx required, csv optional if sheet mapping is provided).
2. Define required sheets, optional sheets, and blocking conditions.
3. Define policy for LEGEND & SUMMARY and Answer_Key handling.
4. Define clarification thresholds:
   - confidence cutoff
   - missing required field behavior
   - duplicate/ambiguous mapping behavior
5. Define resume payload contract for approve, reject, modify decisions.

Output:
- Ingestion acceptance policy.
- Clarification decision contract.

Gate to Step 3:
- Policy approved and test cases documented.

### Step 3 - Scaffold PMO Module
Implement:
1. Create pmo module using module generator.
2. Add register, contracts, events, rbac, and agent-tools structure.
3. Add exports so runtime can compose PMO workflow contribution.

Output:
- PMO module compiles and resolves in workspace imports.

Gate to Step 4:
- Typecheck passes for PMO skeleton.

### Step 4 - Design DB Schema and Run Migrations
Implement:
1. Create pmo.ingestion_sessions:
   - ingestion_id, tenant_id, created_by, source_file_id
   - status, current_step, detected_schema, confirmed_mapping
   - started_at, updated_at, finished_at
2. Create pmo.ingestion_sheet_profiles:
   - sheet_name, detected_header_row, detected_columns, confidence_summary
3. Create pmo.ingestion_validation_issues:
   - ingestion_id, table_name, row_ref, column_name, issue_code, severity, message
4. Create normalized canonical tables for production scope:
   - pmo.ds01_resource_allocation
   - pmo.ds02_timesheet_log
   - pmo.ds03_overbook_idle_config
   - pmo.ds04_leave_holiday_records
   - pmo.ds05_project_master
   - pmo.ds06_member_master
   - pmo.ref_calendar_weeks
   - pmo.ref_kpi_norms
5. Add indexes for tenant_id, ingestion_id, status, updated_at and critical lookup keys.

Output:
- Migration set creates complete PMO ingestion and canonical tables.

Gate to Step 5:
- Migration apply succeeds and schema smoke test passes.

### Step 5 - Build Session Domain and Transition Guard
Implement:
1. Build ingestion session service to start from uploaded file.
2. Persist step transitions and audit trail.
3. Enforce valid state-machine transitions.
4. Persist mapping decision artifacts for replay and debugging.

Output:
- Domain lifecycle API for workflow orchestration.

Gate to Step 6:
- Unit tests pass for allowed and blocked transitions.

### Step 6 - Implement Workbook Parser and Profiler
Implement:
1. Parse workbook and detect available sheets.
2. For each target sheet:
   - detect header row
   - parse columns and sample types
   - apply DS05 and DS06 row-2 header rule
3. Produce profile result with confidence per sheet and per column.

Output:
- detectWorkbookProfile(file) returns sheet profile + structural warnings.

Gate to Step 7:
- Parser tests pass on happy-path and malformed workbook fixtures.

### Step 7 - Build Mapping Inference and Clarification Payload
Implement:
1. Infer mapping from source columns to canonical columns.
2. Compute confidence matrix and rationale.
3. Trigger clarification when thresholds fail.
4. Build proposed payload for approval card:
   - per-sheet mapping
   - unresolved fields
   - warnings and expected impact

Output:
- detectSchemaAndMapping(file) returns deterministic mapping proposal.

Gate to Step 8:
- Inference tests pass for missing, duplicate, and low-confidence scenarios.

### Step 8 - Implement Evented Workflow with Suspend/Resume
Implement:
1. Create evented workflow pmo.ingestData with ordered steps:
   - step A: profile-and-map
   - step B: confirm-mapping (suspend)
   - step C: normalize
   - step D: validate
   - step E: publish
2. Define explicit suspendSchema and resumeSchema for step B.
3. Branch rules:
   - approve: continue to normalize
   - modify: apply modified mapping and continue to normalize
   - reject: mark run rejected and stop

Output:
- Durable clarification loop running on workflow suspend/resume.

Gate to Step 9:
- Integration tests pass for approve, modify, and reject branches.

### Step 9 - Wire Approval Decision to Resume Path
Implement:
1. Render mapping payload inside HITL approval request.
2. Map decision endpoint payload to workflow resumeData.
3. Ensure resume is called on suspended confirm step.
4. Assert detect step is not re-executed after approve or modify.

Output:
- Decision-to-resume path is deterministic and idempotent.

Gate to Step 10:
- Tests confirm no backward jump to detect step after decision.

### Step 10 - Normalize into Canonical Tables
Implement:
1. Transform input rows into canonical schema rows for all production scope sheets.
2. Apply type conversion and nullability policy.
3. Persist normalized records with ingestion trace keys.
4. Keep Answer_Key out of production normalization path.

Output:
- Canonical normalized dataset persisted by table.

Gate to Step 11:
- Normalization tests pass for full, partial, and sparse data.

### Step 11 - Validate Referential and KPI Rules
Implement:
1. Column-level validation:
   - required fields
   - enum validity
   - date parse validity
   - numeric range
2. Relationship validation:
   - Member_ID, Project_ID, PM_ID, Line_manager_id integrity checks
3. KPI rule checks using REF_KPI_Norms thresholds where applicable.
4. Persist validation report in pmo.ingestion_validation_issues.

Output:
- Deterministic validation report with severity and remediation hints.

Gate to Step 12:
- Validation test suite passes with expected issue counts and severities.

### Step 12 - Publish, Emit Events, and Expose UI
Implement:
1. Publish validated records to canonical PMO tables.
2. Emit domain events via outbox for downstream subscribers.
3. Update ingestion status to published or failed.
4. Build web clarification card and run monitoring:
   - show mapping, confidence, and warnings
   - allow approve, reject, modify
   - refresh run state after decision

Output:
- End-to-end ingestion UX from upload to publish.

Gate to Step 13:
- E2E passes: ambiguous mapping -> modify -> normalize -> validate -> publish.

### Step 13 - Replay/Rerun Resilience and Rollout
Implement:
1. Replay-from-step support for normalize, validate, publish (in-place run).
2. Rerun support for full restart (new run ID).
3. Retry and timeout handling for parser, workflow, and validation failures.
4. Quality gates:
   - unit tests
   - integration tests
   - e2e tests
   - typecheck and lint
5. Rollout by tenant-level feature flag and pilot checklist.

Output:
- Production-ready rollout plan with fallback and observability.

Final completion gate:
- Typecheck, lint, and tests all pass.
- Pilot tenant runs within agreed SLO.

## Implementation Order Summary
1. Freeze canonical contract
2. Define boundary and clarification policy
3. Scaffold module
4. DB schema and migrations
5. Session domain and transition guard
6. Workbook parser and profiler
7. Mapping inference and clarification payload
8. Evented suspend/resume workflow
9. Approval-to-resume wiring
10. Canonical normalization
11. Validation rules and KPI checks
12. Publish, events, and UI
13. Replay/rerun resilience and rollout

If sprint slicing is needed:
- Sprint 1: Steps 1 to 5
- Sprint 2: Steps 6 to 9
- Sprint 3: Steps 10 to 13
