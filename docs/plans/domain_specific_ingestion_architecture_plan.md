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

## Suggested Implementation Order

1. Add `IngestionDomainConfig` types.
2. Add file-based domain registry.
3. Convert `PMO_CANONICAL_SCHEMA` into `config/ingestion-domains/pmo/domain.json`.
4. Add PMO domain adapter.
5. Refactor table mapping to read `domainConfig`.
6. Refactor column mapping to read `domainConfig`.
7. Refactor normalization/reference validation to read `referenceRules`.
8. Refactor stage/diff to use `tableConfig.naturalKey`.
9. Move publish behind adapter.
10. Add `domainId` and `domainConfigVersion` to session/workflow state.
11. Add HR sample config to prove generic behavior.
12. Add DB-backed schema registry and admin UI only after file-based config is stable.

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
