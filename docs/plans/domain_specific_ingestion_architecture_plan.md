# Domain-Specific Ingestion Architecture Plan

## Goal

Refactor the current PMO ingestion workflow into a reusable ingestion architecture where the pipeline is generic and each business domain supplies its own schema catalog and adapter.

The target architecture is:

```text
ENV
  -> runtime knobs only: config source, enabled domains, model, thresholds, safety mode

Domain Config / Schema Registry
  -> table descriptions, column descriptions, synonyms, natural keys, validation rules,
     reference rules, duplicate policies, publish policy

Domain Adapter
  -> DB lookup, publish/upsert behavior, tenant scoping, and domain-specific rules that
     cannot be represented safely as generic config

Generic Ingestion Pipeline
  -> profile workbook, map table, map columns, normalize, validate, stage, summarize, publish
```

This should let PMO remain the first domain while making HR, Finance, or other departments possible without hardcoding table names like `member_master`, `member_id`, `project_master`, or `project_id` inside the generic workflow.

## Non-Goals

- Do not store table descriptions, column descriptions, synonyms, natural keys, reference rules, or business validation rules in environment variables.
- Do not promise that config alone can ingest every domain. Simple domains may only need config, but domains with DB lookup, publish policy, duplicate handling, or business-specific rules need a domain adapter.
- Do not introduce raw cross-schema SQL as the generic solution. Keep module boundaries and existing architecture rules intact.
- Do not rewrite the PMO UI into a fully generic ingestion UI in the first pass unless required by backend contracts.

## Environment Variables

Environment variables should configure runtime behavior only.

Recommended env:

```env
INGESTION_DOMAIN_CATALOG_SOURCE=file
INGESTION_DOMAIN_CATALOG_DIR=./config/ingestion-domains
INGESTION_ENABLED_DOMAINS=pmo,hr,finance
INGESTION_DEFAULT_DOMAIN=pmo

INGESTION_MAPPING_LLM_ENABLED=true
INGESTION_MAPPING_MODEL=openai/gpt-5.5
INGESTION_MAPPING_CONFIDENCE_AUTO_ACCEPT=0.85
INGESTION_MAPPING_CONFIDENCE_REVIEW=0.65

INGESTION_REQUIRE_PUBLISH_APPROVAL=true
INGESTION_ALLOW_DIRECT_PUBLISH=false
INGESTION_REFERENCE_CHECK_ENABLED=true
INGESTION_REQUIRE_HUMAN_REVIEW_ON_LOW_CONFIDENCE=true
```

These should not be env values:

```text
table descriptions
column descriptions
synonyms
natural keys
reference rules
validation rules
duplicate policy per table
publish targets
mapping overrides
long prompts
per-tenant config
```

Those belong in JSON/YAML for the MVP, then in a database-backed schema registry later.

## Phase 1: Create Generic Domain Config Contracts

Add a generic ingestion package or module boundary. Preferred location:

```text
packages/ingestion/src/domain-config.ts
```

If creating a new package is too large for the first PR, create the contract in PMO first under an internal path and move it later:

```text
packages/pmo/src/backend/ingestion/domain-config.ts
```

Core types:

```ts
export interface IngestionDomainConfig {
  domainId: string;
  version: string;
  label: string;
  description?: string;
  tables: IngestionTableConfig[];
  referenceRules: ReferenceRule[];
  validationRules: ValidationRule[];
  publishPolicy: PublishPolicy;
}

export interface IngestionTableConfig {
  id: string;
  label: string;
  description: string;
  synonyms: string[];
  naturalKey: string[];
  duplicatePolicy: 'allow' | 'skip' | 'block';
  fields: IngestionFieldConfig[];
}

export interface IngestionFieldConfig {
  name: string;
  label: string;
  description: string;
  dataType: 'string' | 'number' | 'date' | 'boolean' | 'percentage';
  required: boolean;
  synonyms: string[];
}

export interface ReferenceRule {
  sourceTable: string;
  sourceField: string;
  targetTable: string;
  targetField: string;
  blocking: boolean;
  resolutionActions: Array<'add_missing_master' | 'map_to_existing' | 'exclude_rows' | 'reject_run'>;
}

export interface ValidationRule {
  id: string;
  tableId: string;
  fieldName?: string;
  type: 'required' | 'range' | 'enum' | 'date_order' | 'custom';
  severity: 'info' | 'warning' | 'blocking';
  config: Record<string, unknown>;
}

export interface PublishPolicy {
  requireApproval: boolean;
  allowDirectPublish: boolean;
  mode: 'staged' | 'direct';
}
```

Acceptance criteria:

- The contract can describe current PMO canonical tables and fields.
- Natural keys are config-driven.
- Reference rules can express PMO `resource_allocation.member_id -> member_master.member_id` and HR `attendance.employee_id -> employee_master.employee_id`.
- Duplicate policy can be set per table.

## Phase 2: Add Domain Config Registry

Create a registry that loads domain configs by `domainId`.

Preferred files:

```text
packages/ingestion/src/domain-registry.ts
config/ingestion-domains/pmo/domain.json
config/ingestion-domains/hr/domain.json
```

MVP implementation:

```ts
export interface IngestionDomainRegistry {
  load(domainId: string): Promise<IngestionDomainConfig>;
  listEnabled(): Promise<Array<{ domainId: string; label: string; version: string }>>;
}
```

MVP source:

```text
INGESTION_DOMAIN_CATALOG_SOURCE=file
INGESTION_DOMAIN_CATALOG_DIR=./config/ingestion-domains
```

Future source:

```text
INGESTION_DOMAIN_CATALOG_SOURCE=db
```

Acceptance criteria:

- PMO config loads from JSON.
- Unknown or disabled domains fail with a clear error.
- Config validation runs at startup or first load.
- Config version is attached to workflow/session state.

## Phase 3: Move PMO Canonical Schema Into Config

Current hardcoded source:

```text
packages/pmo/src/backend/ingestion/canonical-schema.ts
```

Target:

```text
config/ingestion-domains/pmo/domain.json
```

The PMO config should include:

- `resource_allocation`
- `timesheet`
- `leave`
- `member_master`
- `project_master`
- `overbook_idle_config`
- `calendar_weeks`
- `kpi_norms`

For each table, include:

- table id
- table label
- table description
- synonyms
- natural key fields
- duplicate policy
- fields with labels, descriptions, data types, required flags, and synonyms

PMO reference rules should include at least:

```json
[
  {
    "sourceTable": "resource_allocation",
    "sourceField": "member_id",
    "targetTable": "member_master",
    "targetField": "member_id",
    "blocking": true,
    "resolutionActions": ["add_missing_master", "map_to_existing", "exclude_rows", "reject_run"]
  },
  {
    "sourceTable": "timesheet",
    "sourceField": "member_id",
    "targetTable": "member_master",
    "targetField": "member_id",
    "blocking": true,
    "resolutionActions": ["add_missing_master", "map_to_existing", "exclude_rows", "reject_run"]
  },
  {
    "sourceTable": "resource_allocation",
    "sourceField": "project_id",
    "targetTable": "project_master",
    "targetField": "project_id",
    "blocking": true,
    "resolutionActions": ["add_missing_master", "map_to_existing", "exclude_rows", "reject_run"]
  },
  {
    "sourceTable": "timesheet",
    "sourceField": "project_id",
    "targetTable": "project_master",
    "targetField": "project_id",
    "blocking": true,
    "resolutionActions": ["add_missing_master", "map_to_existing", "exclude_rows", "reject_run"]
  }
]
```

Acceptance criteria:

- PMO config contains the same semantic information as `PMO_CANONICAL_SCHEMA`.
- Existing PMO mapping tests can be migrated to use config.
- No mapping or normalization code needs to import `PMO_CANONICAL_SCHEMA` directly after this phase.

## Phase 4: Introduce Domain Adapter Interface

Create an adapter contract:

```ts
export interface IngestionDomainAdapter {
  domainId: string;

  findReferenceValues(input: {
    tenantId: string;
    tableId: string;
    fieldName: string;
  }): Promise<Set<string>>;

  findActiveRecords(input: {
    tenantId: string;
    tableId: string;
  }): Promise<Array<{ natural_key_hash: string; source_row_hash: string }>>;

  publish(input: {
    tenantId: string;
    ingestionSessionId: string;
  }): Promise<PublishResult>;
}
```

Create a PMO adapter:

```text
packages/pmo/src/backend/ingestion/pmo-ingestion-adapter.ts
```

PMO adapter responsibilities:

- Resolve `member_master.member_id` from `pmo.member_master`.
- Resolve `project_master.project_id` from `pmo.project_master`.
- Resolve active records per target table for database diff.
- Own PMO publish/upsert behavior currently in `publish-upsert.ts`.

Future HR adapter responsibilities:

- Resolve `employee_master.employee_id`.
- Resolve `department_master.department_code`.
- Own HR publish/upsert behavior.

Acceptance criteria:

- Generic pipeline does not import PMO DB tables directly.
- PMO-specific DB access lives behind `PmoIngestionAdapter`.
- Tests cover reference lookup and publish delegation.

## Phase 5: Refactor Table Mapping

Current files likely affected:

```text
packages/pmo/src/backend/ingestion/detect-schema.ts
packages/pmo/src/backend/ingestion/detect-sheet-role.ts
packages/pmo/src/backend/ingestion/scoring/sheet-context.ts
packages/pmo/src/backend/ingestion/llm-mapping-hints.ts
```

Change from:

```ts
PMO_CANONICAL_SCHEMA.tables
```

to:

```ts
domainConfig.tables
```

The table mapping input should include:

```ts
interface DetectSchemaInput {
  workbookProfile: WorkbookProfile;
  domainConfig: IngestionDomainConfig;
}
```

LLM/table scorer should receive:

- workbook sheet name
- workbook headers
- sample values
- row count
- candidate table id
- candidate table label
- candidate table description
- candidate table synonyms
- required fields
- field descriptions

Acceptance criteria:

- PMO table mapping behavior remains equivalent.
- An HR config can be loaded and table candidates can be produced without code changes.
- Tests verify that table descriptions and synonyms from config influence mapping.

## Phase 6: Refactor Column Mapping

Current files likely affected:

```text
packages/pmo/src/backend/ingestion/map-columns.ts
packages/pmo/src/backend/ingestion/scoring/header-similarity.ts
packages/pmo/src/backend/ingestion/scoring/value-pattern.ts
packages/pmo/src/backend/ingestion/scoring/data-type.ts
packages/pmo/src/backend/ingestion/scoring/cross-sheet.ts
packages/pmo/src/backend/ingestion/llm-mapping-hints.ts
```

Change column mapping input to:

```ts
interface MapColumnsInput {
  sourceSheetProfile: SheetProfile;
  targetTable: IngestionTableConfig;
  domainConfig: IngestionDomainConfig;
}
```

Column mapping should use:

- field name
- field label
- field description
- data type
- required flag
- synonyms
- reference rules where useful
- sample source values

Acceptance criteria:

- No column mapping logic references PMO table IDs directly.
- PMO tests still pass.
- HR sample config can map `employee_id`, `department_code`, or similar fields using only config.

## Phase 7: Refactor Normalize And Reference Validation

Current hardcoded file:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/handlers/normalize-to-staging.ts
```

Current PMO-specific references to remove:

```text
member_master.member_id
project_master.project_id
resource_allocation.member_id
timesheet.project_id
leave.member_id
```

Target logic:

```ts
for (const rule of domainConfig.referenceRules) {
  const sourceRows = normResult.tables[rule.sourceTable] ?? [];
  const uploadedTargetRows = normResult.tables[rule.targetTable] ?? [];

  const uploadedTargetValues = collectUploadedReferenceIds(uploadedTargetRows, rule.targetField);
  const dbTargetValues = await adapter.findReferenceValues({
    tenantId,
    tableId: rule.targetTable,
    fieldName: rule.targetField,
  });

  for (const row of sourceRows) {
    const value = normalizeReferenceValue(row.values[rule.sourceField]);
    if (!value) continue;
    if (uploadedTargetValues.has(value) || dbTargetValues.has(value)) continue;

    addIssue({
      tableId: rule.sourceTable,
      sourceRow: row.sourceRow,
      field: rule.sourceField,
      reason: `unresolved reference: ${rule.sourceField} "${value}" not found in ${rule.targetTable}.${rule.targetField}`,
    });
  }
}
```

Acceptance criteria:

- Reference validation is fully driven by `domainConfig.referenceRules`.
- DB lookup goes through the domain adapter.
- PMO unresolved member/project tests still pass.
- HR can define `attendance.employee_id -> employee_master.employee_id` without changing normalize code.

## Phase 8: Refactor Stage And Database Diff

Current hardcoded file:

```text
packages/pmo/src/backend/ingestion/stage-changes.ts
```

Current hardcoded structure:

```ts
const NATURAL_KEY_FIELDS: Record<string, string[]> = { ... };
```

Target:

```ts
computeNaturalKeyHash(tableConfig.naturalKey, tenantId, values)
computeSourceRowHash(tableConfig.fields, tableConfig.naturalKey, values)
classifyRows(tableConfig, tenantId, normalizedRows, activeRecords)
```

Active DB records should come from:

```ts
adapter.findActiveRecords({ tenantId, tableId })
```

Acceptance criteria:

- Natural keys are config-driven.
- Database diff can classify `new_record`, `updated_record`, `exact_duplicate`, and `duplicate_in_upload` using config.
- PMO `resource_allocation`, `timesheet`, and master table diffs remain equivalent.

## Phase 9: Move Publish Behind Adapter

Current PMO-specific file:

```text
packages/pmo/src/backend/ingestion/publish-upsert.ts
```

Generic publish step should not know PMO tables. It should call:

```ts
const result = await adapter.publish({ tenantId, ingestionSessionId });
```

Files likely affected:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/handlers/publish-after-approval.ts
packages/pmo/src/backend/workflows/ingest-data-v2/handlers/database-change-summary.ts
packages/pmo/src/backend/ingestion/publish-upsert.ts
```

Acceptance criteria:

- PMO publish behavior remains in PMO adapter.
- Generic publish handler only enforces approval and delegates to adapter.
- Future HR publish can be added through an HR adapter.

## Phase 10: Add Domain ID To Workflow And Session State

Files likely affected:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/orchestrator.ts
packages/pmo/src/backend/workflows/ingest-data-v2/context.ts
packages/pmo/src/backend/workflows/ingest-data-v2/schemas.ts
packages/pmo/src/backend/http/routes.ts
apps/web/src/modules/pmo/api/client.ts
```

Workflow/session should persist:

```ts
domainId: string;
domainConfigVersion: string;
```

Orchestrator startup should do:

```ts
const domainConfig = await domainRegistry.load(domainId);
const adapter = domainAdapterRegistry.get(domainId);
```

Acceptance criteria:

- Existing PMO flows default to `domainId = "pmo"`.
- Session state records config version for reproducibility.
- Resume uses the same domain config version when possible.

## Phase 11: UI Strategy

For the first implementation, keep PMO UI mostly PMO-specific. The cards can still be rendered by PMO page, but card text should increasingly use labels from config.

Short-term:

- PMO page continues to initiate PMO ingestion.
- Review cards display table labels and field labels from config where possible.
- Error text avoids hardcoded "member/project" phrasing when generated by generic validation.

Future:

- Add generic ingestion page with `domainId` selection.
- Add admin UI for schema registry.
- Add domain catalog editor with validation preview.

Acceptance criteria:

- PMO UI behavior does not regress.
- Generic cards can display HR labels if backend emits them.

## Phase 12: Testing Strategy

Add tests at three levels.

Unit tests:

- Domain config validation.
- Domain registry load.
- Table mapping using config descriptions and synonyms.
- Column mapping using config field descriptions and synonyms.
- Reference validation using config rules.
- Natural key hashing from config.

Integration tests:

- PMO flow parity with current behavior.
- PMO unresolved member/project reference blocks normalization.
- PMO stage/diff/publish still works.

Contract/sample tests:

- Minimal HR config loads.
- HR attendance can map `employee_id` through config.
- HR reference rule can block unresolved employee IDs without changing generic code.

## Review-Gated Proposal and Checkpoint Refactor Plan

This refactor formalizes the review-gated pattern that PMO v2 already uses in
pieces today. It should not rewrite the PMO ingestion pipeline. Instead, it
should standardize reviewable step outputs, make approved state immutable and
versioned, and enforce downstream dependencies in the workflow/state machine
layer.

Core invariants:

```text
Planner proposes. Executor enforces.

Only approved checkpoints may satisfy dependencies for review-gated downstream steps.

Internal artifacts may be persisted for reproducibility, but they cannot unlock gated downstream steps.

Approved checkpoints are immutable and versioned.
```

The generic control-plane model is:

```text
reviewable tool output
  -> ToolProposal<T>
  -> ReviewGate
  -> ApprovedCheckpoint<T>
  -> downstream tool input
```

This model applies only to outputs that need human review or carry semantic
risk. It should not wrap every internal tool artifact. Raw parse results, column
statistics, workbook cache data, normalized intermediate rows, and other
machine-only artifacts may remain internal artifacts. They can be persisted for
replay and debugging, but they must not satisfy dependencies for review-gated
downstream steps.

### Refactor Phase 0: Document the Control-Plane Invariants

Goal:

- Make the proposal/checkpoint rules explicit before changing code.
- Align PMO-specific docs with the generic ingestion architecture.

Steps:

1. Add the invariants above to the architecture plan.
2. Update PMO ingestion docs to describe existing PMO v2 state as an implicit
   version of the same pattern:
   - `detected_schema` is a proposal-like artifact.
   - `confirmed_mapping` is a checkpoint-like artifact.
   - `staging_result` is a DB change summary or normalization artifact.
3. Document that the planner may choose an intended next step, but the executor
   decides whether the step is allowed.
4. Document that checkpoints are immutable. If user input, supplemental upload,
   or rerun changes an approved result, create a new proposal and checkpoint
   version instead of mutating the old checkpoint.

Acceptance criteria:

- Docs clearly state that gates are enforced by code, not prompts.
- Docs distinguish reviewable outputs from internal artifacts.
- Docs state that PMO is the first domain adapter on the generic ingestion
  control plane, not a pipeline to rewrite from scratch.

### Refactor Phase 1: Add Generic Review Contracts

Goal:

- Add reusable types for reviewable outputs and approved checkpoints.
- Keep the first implementation narrow enough to avoid PMO behavior churn.

Preferred file:

```text
packages/ingestion/src/review-contracts.ts
```

Temporary file if `packages/ingestion` is not introduced yet:

```text
packages/pmo/src/backend/ingestion/review-contracts.ts
```

Contracts:

```ts
export type ReviewAction = 'approve' | 'modify' | 'upload_more' | 'rerun' | 'reject';

export type ReviewableStatus = 'needs_review' | 'completed' | 'failed';

export interface ToolProposal<T> {
  proposal_id: string;
  step_id: string;
  version: number;
  status: ReviewableStatus;
  proposal: T;
  review_required: boolean;
  next_allowed_actions: ReviewAction[];
  created_at: string;
  created_by: 'system' | 'agent' | string;
  source_artifact_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ApprovedCheckpoint<T> {
  checkpoint_id: string;
  proposal_id: string;
  step_id: string;
  version: number;
  approved_at: string;
  approved_by: string;
  approved_output: T;
  user_overrides: unknown[];
  metadata?: Record<string, unknown>;
}

export interface ReviewGateState<TProposal = unknown, TApproved = unknown> {
  step_id: string;
  latest_proposal?: ToolProposal<TProposal>;
  latest_approved_checkpoint?: ApprovedCheckpoint<TApproved>;
  proposal_history: Array<ToolProposal<TProposal>>;
  checkpoint_history: Array<ApprovedCheckpoint<TApproved>>;
}
```

Steps:

1. Add the contracts with unit tests for basic validation helpers if schemas are
   implemented with Zod.
2. Keep payload generics domain-neutral.
3. Add a short comment or docblock explaining that only reviewable outputs
   should use `ToolProposal<T>`.
4. Export contracts through the public package surface if the file lives in a
   new `packages/ingestion` package.

Acceptance criteria:

- Contracts compile and are available to PMO workflow code.
- Contracts do not import PMO-specific types or table names.
- No existing PMO runtime behavior changes in this phase.

### Refactor Phase 2: Add Checkpoint Store Helpers

Goal:

- Centralize versioning, immutability, and dependency lookup.
- Avoid direct downstream reads from proposal-like runtime fields.

Preferred files:

```text
packages/ingestion/src/checkpoint-store.ts
packages/ingestion/src/executor-guards.ts
```

Temporary PMO-local files if needed:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/checkpoints.ts
packages/pmo/src/backend/workflows/ingest-data-v2/executor-guards.ts
```

Required helpers:

```ts
createProposal<T>(params): ToolProposal<T>
approveProposal<T>(params): ApprovedCheckpoint<T>
getLatestProposal<T>(state, stepId): ToolProposal<T> | null
getLatestApprovedCheckpoint<T>(state, stepId): ApprovedCheckpoint<T> | null
requireApprovedCheckpoint<T>(state, stepId): ApprovedCheckpoint<T>
appendProposal(state, proposal): state
appendCheckpoint(state, checkpoint): state
```

Steps:

1. Introduce a state shape that can coexist with current PMO fields:

   ```ts
   review_proposals?: Record<string, ToolProposal<unknown>[]>;
   approved_checkpoints?: Record<string, ApprovedCheckpoint<unknown>[]>;
   ```

2. Implement version assignment as append-only:
   - first proposal for a step is version `1`;
   - next proposal for the same step is version `2`;
   - an approved checkpoint uses the proposal version it approves.
3. Make helper functions return copied state objects instead of mutating arrays
   in place.
4. Add `requireApprovedCheckpoint` and use a clear error code when missing.
5. Keep compatibility fields such as `confirmed_mapping` populated while the UI
   and existing routes still read them.

Acceptance criteria:

- A second proposal for the same step creates version `2`, not an overwrite.
- An approved checkpoint remains in history after a later proposal is created.
- Missing approved checkpoint produces a deterministic executor error.
- Existing PMO session fields can still be written for compatibility.

### Refactor Phase 3: Apply the Model to Column Mapping First

Goal:

- Refactor the safest and most important gate first.
- Preserve current PMO v2 behavior while making the checkpoint explicit.

Current PMO shape:

```text
detected_schema
  -> column_mapping handler
  -> mapping review card
  -> confirmed_mapping
  -> normalize_to_staging
```

Target shape:

```text
MappingProposal vN
  -> mapping_review gate
  -> ApprovedCheckpoint<MappingResult> vN
  -> normalize_to_staging
```

Steps:

1. Define `MappingResult` around the existing effective mapping payload:

   ```ts
   interface MappingResult {
     confirmedMappings: unknown[];
     mappingReviewRows: Array<{ k: string; v: string }>;
   }
   ```

2. When mapping needs user review, create and persist
   `ToolProposal<MappingResult>` with:
   - `step_id = "column_mapping"`;
   - `status = "needs_review"`;
   - `review_required = true`;
   - allowed actions that match the card behavior.
3. When mapping auto-confirms, create an approved checkpoint immediately with
   `approved_by = "system"` or the resolved actor, and keep
   `confirmed_mapping` compatibility output.
4. When the user approves or modifies mapping items, apply overrides to produce
   an effective mapping result, then append `ApprovedCheckpoint<MappingResult>`.
5. Store mapping overrides in `user_overrides`; do not mutate the original
   proposal.
6. Keep the current item-by-item review UX intact.

Acceptance criteria:

- Mapping review still suspends when current behavior says it should suspend.
- User mapping overrides become checkpoint metadata or `user_overrides`.
- `confirmed_mapping` remains populated for compatibility.
- A unit test proves that modifying a mapping creates an approved checkpoint from
  the effective mapping, not by mutating the proposal.

### Refactor Phase 4: Make Normalize Depend on Approved Mapping Checkpoint

Goal:

- Replace implicit dependency on `confirmed_mapping` with an explicit checkpoint
  dependency.

Steps:

1. In `normalize_to_staging`, read:

   ```ts
   requireApprovedCheckpoint<MappingResult>(state, 'column_mapping')
   ```

2. Use `approved_output.confirmedMappings` as the mapping source for
   normalization.
3. Keep fallback to legacy `confirmed_mapping` only behind a migration or
   compatibility helper, and log/mark it as compatibility-only if used.
4. Remove any path where `detected_schema.tableMappings` can flow directly into
   normalize after a review-required result.
5. Add a test that attempts normalize with a proposal but no approved checkpoint
   and expects failure.

Acceptance criteria:

- Normalize cannot run with only `MappingProposal`.
- Normalize succeeds with `ApprovedCheckpoint<MappingResult>`.
- Existing PMO happy-path tests still pass.

### Refactor Phase 5: Apply the Model to Workbook Profiling

Goal:

- Formalize profiling review and supplemental upload behavior.
- Make additional uploads create new proposal/checkpoint versions instead of
  changing an approved checkpoint.

Target shape:

```text
WorkbookProfilingProposal v1
  -> profiling_review gate
  -> ApprovedCheckpoint<ProfilingResult> v1
  -> column_mapping

Supplemental upload
  -> WorkbookProfilingProposal v2
  -> profiling_review gate
  -> ApprovedCheckpoint<ProfilingResult> v2
```

Steps:

1. Define `ProfilingResult` around existing profiling documents, summary, and
   review state that downstream steps need.
2. Create `ToolProposal<ProfilingResult>` after workbook profiling completes.
3. On profiling approve/continue, append
   `ApprovedCheckpoint<ProfilingResult>`.
4. On user edits, waived missing areas, or supplemental upload, create a new
   proposal version.
5. If supplemental upload invalidates mapping assumptions, mark the mapping
   checkpoint as superseded in metadata and require a new mapping proposal.
   Do not delete or mutate the old mapping checkpoint.
6. Keep existing profiling HTTP endpoints stable while they write the new
   proposal/checkpoint state.

Acceptance criteria:

- Profiling approval creates an immutable checkpoint.
- Supplemental upload creates a new profiling proposal version.
- Existing profiling history is still visible through current PMO UI/API.
- Downstream mapping uses the latest approved profiling checkpoint when the new
  state is available.

### Refactor Phase 6: Apply the Model to DB Diff and Publish Review

Goal:

- Prevent publish from using unapproved DB change summaries when publish
  approval is required.

Target shape:

```text
normalize internal artifacts
  -> DBChangeSummaryProposal vN
  -> db_change_review gate
  -> ApprovedCheckpoint<DbChangeSummary> vN
  -> publish_after_approval
```

Steps:

1. Define `DbChangeSummary` around existing staging result/change summary data:
   - new rows;
   - updated rows;
   - exact duplicates;
   - duplicate-in-upload blocks;
   - blocking issues;
   - rows skipped.
2. Normalize may persist internal staging artifacts, but it should create a
   reviewable DB change proposal when review is required.
3. The publish step must call:

   ```ts
   requireApprovedCheckpoint<DbChangeSummary>(state, 'database_change_summary')
   ```

   when publish approval is required.
4. If `INGESTION_REQUIRE_PUBLISH_APPROVAL=false` for a safe domain, document and
   test the direct publish path separately.
5. Preserve the existing PMO rules:
   - `duplicate_in_upload` blocks publish approval;
   - blocking issues block publish approval;
   - exact duplicates are skipped.

Acceptance criteria:

- Publish cannot run from raw `staging_result` when approval is required.
- Publish can run from an approved DB change checkpoint.
- Blocked DB diff proposals cannot produce approved checkpoints.
- Existing PMO publish review card still renders the same key details.

### Refactor Phase 7: Move Generic Pieces Out of PMO

Goal:

- Make PMO the first domain adapter on a generic ingestion control plane.
- Avoid keeping reusable control-plane rules inside PMO-specific handlers.

Target package shape:

```text
packages/ingestion/
  src/domain-config.ts
  src/domain-registry.ts
  src/review-contracts.ts
  src/checkpoint-store.ts
  src/executor-guards.ts
```

PMO-specific shape:

```text
packages/pmo/src/backend/ingestion/pmo-domain-adapter.ts
packages/pmo/src/backend/workflows/ingest-data-v2/
```

Steps:

1. Move domain-neutral review/checkpoint code into `packages/ingestion`.
2. Export stable public APIs from `packages/ingestion/src/index.ts`.
3. Keep PMO-specific business behavior in the PMO adapter:
   - natural key behavior;
   - reference lookups;
   - duplicate policy edge cases;
   - publish/upsert behavior;
   - PMO-specific validation.
4. Update PMO imports to use the public `@seta/ingestion` surface.
5. Run dependency-cruiser and keep cross-module imports compliant.

Acceptance criteria:

- `packages/ingestion` imports no PMO code.
- PMO imports generic ingestion contracts through a public package surface.
- No shared package imports a feature module.
- PMO behavior remains equivalent.

### Refactor Phase 8: Add End-to-End Gate Tests

Goal:

- Prove the executor enforces gates regardless of planner output.

Required tests:

1. Normalize fails when only a mapping proposal exists.
2. Normalize succeeds when an approved mapping checkpoint exists.
3. Mapping modification creates a new approved checkpoint version.
4. Supplemental upload creates a new profiling proposal version.
5. Publish fails when only a DB change proposal exists and publish approval is
   required.
6. Publish succeeds when an approved DB change checkpoint exists.
7. Planner cannot bypass executor gates by selecting a later step.
8. Existing PMO approve/reject paths still work.

Acceptance criteria:

- Tests cover suspend/resume boundaries, not only pure helper functions.
- Tests assert checkpoint history is append-only.
- Tests assert legacy compatibility fields do not unlock gated steps by
  themselves after the checkpoint model is active.

### Refactor Phase 9: Compatibility Cleanup

Goal:

- Remove or mark legacy PMO fields once UI/API consumers have moved to the
  checkpoint model.

Steps:

1. Identify all reads of:
   - `detected_schema`;
   - `confirmed_mapping`;
   - `change_summary`;
   - `staging_result`;
   - `profiling_review`.
2. Replace downstream dependency reads with checkpoint helpers.
3. Keep read-only compatibility projections if the UI still needs old shapes.
4. Document fields as compatibility-only before removing them from any public
   contract.
5. Remove dead helper paths and stale docs once no runtime code depends on them.

Acceptance criteria:

- There is one source of truth for gate dependencies: approved checkpoints.
- Compatibility fields are either removed or explicitly projection-only.
- PMO docs and implementation docs describe the same behavior.

## Planner Intent and Step Selection Refactor Plan

The planner must not expand every vague or review-only goal into the full
ingestion chain. A user goal such as `Review this file` should compile to the
smallest workflow that satisfies review intent. It should not include mapping,
normalization, database diff, or publish unless the user intent explicitly asks
for those outcomes or prior state already makes them the next allowed step.

The planner is allowed to propose intent and candidate steps. The executor is
still responsible for enforcing whether a step can run.

```text
Planner proposes candidate workflow.
Workflow compiler trims and validates candidate workflow.
Executor enforces current-state gates and checkpoint dependencies.
```

### Planner Phase 0: Define Intent Modes

Goal:

- Classify the user goal before generating steps.
- Use intent mode to cap the maximum workflow depth.

Intent modes:

```ts
type IngestionIntentMode =
  | 'review_only'
  | 'mapping_readiness'
  | 'stage_preview'
  | 'publish_intent';
```

Mode rules:

- `review_only`: user asks to review, inspect, check, understand, summarize, or
  validate the uploaded file without asking to map, ingest, stage, compare, or
  publish.
- `mapping_readiness`: user asks to prepare/verify mapping, align workbook
  columns, or make the file ready for later ingestion.
- `stage_preview`: user asks to ingest, load, normalize, compare, preview DB
  changes, or prepare a database change summary without explicitly publishing.
- `publish_intent`: user asks to publish, apply, commit, sync to system,
  update PMO data, or otherwise write approved changes to canonical tables.

Examples:

| Goal | Intent mode | Maximum steps |
| --- | --- | --- |
| `Review this file` | `review_only` | workbook profiling |
| `Check whether this workbook is usable` | `review_only` | workbook profiling |
| `Review and map this file` | `mapping_readiness` | workbook profiling, column mapping |
| `Prepare this workbook for ingestion` | `mapping_readiness` or `stage_preview` depending on wording | profiling, mapping, optional staging preview |
| `Ingest and show me DB changes` | `stage_preview` | profiling, mapping, normalize/stage, DB change summary |
| `Publish this workbook after approval` | `publish_intent` | full chain including publish approval |

Acceptance criteria:

- `Review this file` never produces publish or DB diff steps.
- Publish is included only when `publish_intent` is detected or explicit user
  feedback asks to include publish.
- Ambiguous goals default to the safer, shorter mode.

### Planner Phase 1: Define a Step Catalog

Goal:

- Prevent invented planner steps such as `document check summary`.
- Keep display labels friendly without creating fake runtime actions.

Canonical step catalog:

```ts
const PMO_PLANNER_STEP_CATALOG = {
  workbook_profiling: {
    planner_step_id: 'pmo.planner.step.workbook_profiling',
    action_id: 'workbook_profiling',
    review_type: 'profiling',
    step_name: 'Workbook profiling',
  },
  column_mapping: {
    planner_step_id: 'pmo.planner.step.column_mapping',
    action_id: 'column_mapping',
    review_type: 'mapping',
    step_name: 'Column mapping',
  },
  normalize_to_staging: {
    planner_step_id: 'pmo.planner.step.normalize_to_staging',
    action_id: 'normalize_to_staging',
    review_type: 'normalization',
    step_name: 'Normalize to staging',
  },
  database_change_summary: {
    planner_step_id: 'pmo.planner.step.database_change_summary',
    action_id: 'database_change_summary',
    review_type: 'publish',
    step_name: 'Database change summary',
  },
  publish_after_approval: {
    planner_step_id: 'pmo.planner.step.publish_after_approval',
    action_id: 'publish_after_approval',
    review_type: 'publish',
    step_name: 'Publish after approval',
  },
} as const;
```

Rules:

- The planner can choose only catalog steps.
- `generic_review` should not be used for PMO ingestion flow planning unless a
  future runtime handler exists for it.
- Summary content such as `document check summary` belongs inside the output of
  `workbook_profiling`, not as a standalone workflow step.
- Step display text may be generated from the catalog, but `action_id` and
  ordering must be deterministic.

Acceptance criteria:

- Unknown step names from the model are dropped or mapped to a known catalog
  step.
- Duplicate or semantically equivalent steps are collapsed.
- UI never renders a model-invented runtime step as if it were executable.

### Planner Phase 2: Compile Intent to Allowed Step Prefix

Goal:

- Make workflow breadth deterministic from intent mode.
- Keep the LLM responsible for explanations, not for deciding unsafe execution
  breadth.

Allowed step prefixes:

```ts
const INTENT_MODE_STEP_PREFIX = {
  review_only: ['workbook_profiling'],
  mapping_readiness: ['workbook_profiling', 'column_mapping'],
  stage_preview: [
    'workbook_profiling',
    'column_mapping',
    'normalize_to_staging',
    'database_change_summary',
  ],
  publish_intent: [
    'workbook_profiling',
    'column_mapping',
    'normalize_to_staging',
    'database_change_summary',
    'publish_after_approval',
  ],
} as const;
```

Steps:

1. Add an intent classifier before plan generation. This can be deterministic
   keyword logic first, then an LLM classifier only if needed.
2. Pass `intent_mode` and `allowed_action_ids` into the planning prompt.
3. Add prompt rules:
   - only output steps from `allowed_action_ids`;
   - do not add optional downstream steps outside the allowed prefix;
   - put summaries inside step descriptions, not as extra steps.
4. After structured output returns, run a deterministic compiler:
   - remove steps whose `action_id` is not in `allowed_action_ids`;
   - remove `generic_review` unless explicitly supported;
   - sort steps by catalog order;
   - collapse duplicates;
   - re-number `step_no`.
5. If the compiler removes any step, add a planner diagnostic for logs but do
   not show the removed step to the user as executable.

Acceptance criteria:

- The structured output parser is not the only guard against bad plans.
- `Review this file` compiles to exactly one executable step:
  `workbook_profiling`.
- A model response containing publish for a review-only goal is trimmed before
  persistence.

### Planner Phase 3: Make Plan Schema Stricter

Goal:

- Reduce the room for model-invented workflow shape.

Schema changes:

1. Add `intent_mode` to the plan schema.
2. Make `planner_step_id`, `action_id`, and `review_type` required instead of
   optional.
3. Consider removing `generic_review` from PMO planning action IDs until there
   is a real runtime handler for it.
4. Add maximum step count by intent mode:
   - review-only max: 1;
   - mapping readiness max: 2;
   - stage preview max: 4;
   - publish intent max: 5.
5. Add a refinement that rejects `publish_after_approval` when
   `intent_mode !== 'publish_intent'`.

Acceptance criteria:

- Invalid or too-broad plans fail validation or are corrected by the compiler.
- Plan persistence only stores validated catalog steps.
- PMO UI receives a deterministic workflow graph.

### Planner Phase 4: Update Few-Shot Examples

Goal:

- Stop teaching the model that every ingestion plan should include publish.

Steps:

1. Add a first few-shot example for `Review this file`:

   ```text
   intent_mode: review_only
   proposed_workflow:
   1. Workbook profiling
   not_yet_performed:
   - Column mapping
   - Normalization
   - Database comparison
   - Database publication
   ```

2. Move the full publish example later and make its goal explicitly say
   `publish`.
3. Remove examples where feedback says "do not publish" but the generated plan
   still includes DB/publish-like surrogate steps.
4. Add one example for `Review and map this file`.
5. Add one example for `Ingest and show DB changes, but do not publish`.

Acceptance criteria:

- The first example matches the safest/default behavior.
- The model sees publish only when the user goal explicitly requests publish.
- The example set distinguishes summary text from executable steps.

### Planner Phase 5: Executor and UI Behavior

Goal:

- Make the visible plan match what can actually run.

Steps:

1. Store both `intent_mode` and `compiled_workflow`.
2. Render `compiled_workflow`, not the raw model proposal, in the run UI.
3. Keep raw model output only as diagnostic metadata if needed.
4. When a review-only run finishes profiling, mark the workflow complete or
   awaiting user decision, not as waiting on mapping/publish.
5. Offer follow-up actions after profiling:
   - continue to mapping;
   - upload more;
   - regenerate plan with broader scope;
   - cancel.

Acceptance criteria:

- A review-only run does not show pending publish-related cards.
- Follow-up expansion creates a new plan/checkpoint version instead of silently
  continuing into downstream steps.
- The progress bar counts only compiled executable steps.

### Planner Phase 6: Tests

Required tests:

1. `Review this file` returns `intent_mode = review_only`.
2. `Review this file` compiles to only `workbook_profiling`.
3. A mocked model output containing `publish_after_approval` for review-only is
   trimmed.
4. A mocked model output containing `Document check summary` is dropped or
   converted into profiling output text, not persisted as a step.
5. `Review and map this file` compiles to profiling and mapping only.
6. `Ingest and show DB changes, do not publish` compiles through DB change
   summary and excludes publish.
7. `Publish this workbook after approval` includes publish.
8. UI progress for review-only uses `1 / 1` step after profiling completes.

Acceptance criteria:

- Planner behavior is deterministic for common short goals.
- Tests cover both prompt output and compiler post-processing.
- Regression tests prove the planner cannot make executor-visible fake steps.

## Suggested Implementation Order

1. Add planner intent mode classification.
2. Add PMO planner step catalog and deterministic workflow compiler.
3. Update planning prompt and few-shot examples so review-only goals compile to
   profiling only.
4. Tighten planner schema and remove or block unsupported invented steps.
5. Add planner tests for `Review this file`, `Review and map this file`, DB
   preview, and publish intent.
6. Add `IngestionDomainConfig` types.
7. Add file-based domain registry.
8. Convert `PMO_CANONICAL_SCHEMA` into `config/ingestion-domains/pmo/domain.json`.
9. Add PMO domain adapter.
10. Refactor table mapping to read `domainConfig`.
11. Refactor column mapping to read `domainConfig`.
12. Add review proposal/checkpoint contracts.
13. Add checkpoint store and executor guard helpers.
14. Refactor PMO mapping review into `MappingProposal` and
   `ApprovedCheckpoint<MappingResult>`.
15. Refactor normalize to require the approved mapping checkpoint.
16. Refactor profiling review into versioned profiling proposals and
    checkpoints.
17. Refactor DB diff/publish review into DB change proposals and checkpoints.
18. Refactor normalization/reference validation to read `referenceRules`.
19. Refactor stage/diff to use `tableConfig.naturalKey`.
20. Move publish behind adapter.
21. Add `domainId` and `domainConfigVersion` to session/workflow state.
22. Move generic review/checkpoint helpers into `packages/ingestion`.
23. Add end-to-end suspend/resume gate tests.
24. Add HR sample config to prove generic behavior.
25. Add DB-backed schema registry and admin UI only after file-based config and
    review-gated control plane are stable.

## Final Output

After this work, the system should look like:

```text
Generic ingestion pipeline
  - does not know PMO-specific table or field names
  - maps tables and columns using domain config
  - normalizes and validates using domain config
  - checks references through config plus adapter
  - stages and summarizes changes using config
  - publishes through adapter

PMO domain
  - pmo domain config
  - pmo adapter
  - PMO-specific DB tables and publish behavior

HR domain
  - hr domain config
  - hr adapter only when DB lookup/publish is needed
```

The important architectural boundary is:

```text
ENV configures runtime.
Domain config describes the business domain.
Domain adapter handles DB and business-specific operations.
Generic ingestion pipeline orchestrates the workflow.
```
