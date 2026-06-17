# PMO Phase 3 Supervisor Agentic System Plan

Last updated: 2025-02-14

## 1. Goal

Phase 3 extends the PMO system from:

- a dynamic ingestion workflow that executes a planner-defined ingestion blueprint

into:

- a multi-mode PMO supervisor agent that can choose between ingestion, DB-based analysis, investigation, and report generation workflows
- a domain-extensible ingestion framework where new domains (HR, Finance, etc.) can be onboarded by registering table and column descriptions, without writing new ingestion code

The target system should support requests like:

1. "Ingest this workbook and publish after review."
2. "Only validate this workbook, do not publish."
3. "Generate overbook/idle report from the current database."
4. "Investigate RA vs Timesheet mismatches for this reporting period."
5. "Suggest rebalance actions for the current quarter."
6. "Ingest this HR employee roster into the employees table."

This phase addresses two concerns:

1. **Supervisor-level orchestration** — making the top-level PMO agent capable of selecting the right workflow mode, sequencing major phases, and re-planning between phases when needed. Not about replacing deterministic business logic inside handlers.
2. **Ingestion extensibility** — making the profiling, table mapping, column mapping, and normalization pipeline metadata-driven so that adding a new domain is a configuration task, not a code task.

## 2. Why Phase 3 Is Needed

Phase 2 solves only one layer of the problem:

- planner-driven execution for ingestion

But the business problem is wider than ingestion in two dimensions.

### 2.1 Wider than ingestion — multiple PMO workflow modes

The PMO agent domain includes:

- workbook ingestion
- data standardization
- validation
- overbook and idle detection
- RA vs actual comparison
- edge-case exclusion
- report generation
- action recommendation

Some users will not want ingestion at all.
They may want to work from already-published database state only.

Because of that, the end-state system should not be modeled as:

- one ingestion workflow with nicer steps

It should be modeled as:

- one supervisor-level PMO agent
- multiple workflow modes under it
- optional controlled re-planning between major phases

### 2.2 Wider than PMO — multi-domain ingestion

The ingestion pipeline (profiling → table mapping → column mapping → normalization → publish) is structurally the same across domains. HR uploads employee rosters, Finance uploads budget sheets, PMO uploads resource allocations — the shape of the work is identical:

1. Read the uploaded sheet structure.
2. Match it against a known target table.
3. Map columns.
4. Validate and normalize.
5. Publish.

What differs between domains is the **target schema** (tables, columns, validation rules, reference lookups) and the **domain-specific analysis** that follows ingestion.

Phase 2 hardcodes PMO-specific knowledge (table names, column semantics, validation rules) into the profiling and mapping steps. Phase 3 should extract that knowledge into an admin-managed **Domain Schema Registry** so that:

- adding a new domain is a configuration task, not a code task
- profiling and mapping become metadata-driven
- domain-specific analysis remains code-driven (separate concern)

## 3. Current Reality Before Phase 3

After Phase 2, the expected system state is:

1. `pmo.ingestData.v2` exists and is planner-driven.
2. Planner steps inside ingestion are dynamic and metadata-driven.
3. PMO page and workflow page align on planner step identity.
4. Suspend/resume works at planner-step level.

What still does not exist after Phase 2:

1. No top-level routing between "ingest" and "analyze from DB".
2. No supervisor that can re-plan after a major phase completes.
3. No unified PMO request contract that separates:
   - source workbook path
   - report-only mode
   - investigation mode
   - publish intent
4. No canonical concept of PMO workflow mode.

## 4. Phase 3 Target Output

After Phase 3, the PMO system should behave like this:

### 4.1 User entry point

The user submits a PMO goal such as:

- ingest this workbook and prepare weekly RA monitoring
- generate mismatch report for this month from DB
- investigate overbooked members for week 35
- suggest rebalance actions for the current quarter

### 4.2 Supervisor behavior

The supervisor:

1. interprets the request
2. identifies the required PMO mode
3. creates a major-phase execution plan
4. dispatches a specialized workflow
5. evaluates the result
6. decides whether to:
   - finish
   - hand results to the user
   - pause for human review
   - re-plan into a follow-up workflow

### 4.3 Final system capabilities

The final system should support at least these modes:

- `ingest_workbook`
- `validate_only`
- `report_from_db`
- `investigate_mismatches`
- `recommend_rebalance_actions`

The final system should also support mixed paths like:

- ingest workbook
- normalize and validate
- publish after approval
- re-plan into report generation
- produce company-wide RA summary and alerts

## 5. Architectural Decision

The recommended Phase 3 shape is:

- `plan -> execute -> bounded re-plan`

Not:

- one-shot plan -> execute only

Not:

- unconstrained re-plan after every low-level step

### Why bounded re-plan is the right fit

This PMO problem has two very different layers:

1. deterministic operational steps
   - parse workbook
   - normalize rows
   - stage changes
   - query DB
   - calculate RA
   - compare RA vs Timesheet

2. agentic orchestration questions
   - should we ingest or use DB only
   - should we publish now or stop at validation
   - should we generate a report now or wait for PMO review
   - after publish, do we need a follow-up alert investigation workflow

So the architecture should be:

- dynamic at the supervisor level
- deterministic at the specialized workflow level

That gives:

- strong control
- clean testability
- lower risk around side effects
- enough flexibility for real PMO usage

## 6. Phase 3 Target Architecture

The system should consist of these layers:

### 6.1 PMO Supervisor Layer

Responsibility:

- interpret user goal
- choose workflow mode
- produce major-phase plan
- launch specialized workflow
- evaluate outputs
- optionally re-plan

Candidate workflow id:

- `pmo.supervisor`

### 6.2 Specialized Workflow Layer

Responsibility:

- execute one major workflow mode deterministically

Expected workflows:

- `pmo.ingestData.v2`
- `pmo.generateReport.v1`
- `pmo.investigateAlerts.v1`
- `pmo.recommendActions.v1`

### 6.3 Shared PMO Analysis Layer

Responsibility:

- reusable domain functions used by multiple workflows

Examples:

- build Member-Project-Week dataset
- calculate RA totals
- detect overbooked members
- detect idle members
- compare RA vs logged time
- exclude leave, holiday, training, approved OT
- generate suggested actions

### 6.4 Shared PMO State Layer

Responsibility:

- persist supervisor state
- persist specialized workflow state
- persist outputs and reusable artifacts

### 6.5 Domain Schema Registry Layer

Responsibility:

- admin-managed catalog of target tables and columns per domain
- provide table descriptions and column descriptions for LLM-based profiling and mapping
- supply sample values (static or dynamically fetched from DB) for column matching
- define validation rules (required, type, enum, regex, range) used during normalization
- declare reference lookups (logical cross-table references without FK constraints)

This layer makes the ingestion pipeline domain-agnostic. Adding a new domain (e.g. HR, Finance) requires:

1. Admin registers target tables and column definitions in the schema registry.
2. The generic profiling step reads the registry to match uploaded sheets to tables.
3. The generic column mapping step reads column descriptions and sample values to suggest mappings.
4. The generic normalization step reads validation rules from the registry.
5. No new ingestion code is written.

Registry lives in `core` schema (foundation tier) so any module can read it.

Architecture with schema registry:

```
User uploads workbook
        │
        ▼
┌───────────────────────┐      ┌──────────────────────────┐
│  Generic Profiling    │─────▶│  Domain Schema Registry  │
│  - read sheet headers │      │  (core.domain_tables,    │
│  - match to tables    │◀─────│   core.domain_columns)   │
└───────────┬───────────┘      │                          │
            │                  │  Admin CRUD:             │
            ▼                  │  - add/edit/remove tables│
┌───────────────────────┐      │  - add/edit/remove cols  │
│  Generic Column Map   │─────▶│  - set validation rules  │
│  - compare headers    │      │  - set sample values     │
│  - fetch sample vals  │◀─────│  - set reference lookups │
└───────────┬───────────┘      └──────────────────────────┘
            │
            ▼
┌───────────────────────┐
│  Generic Normalize    │
│  - apply validation   │
│    rules from registry│
│  - reference lookups  │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│  Generic Publish      │
│  - write to target    │
│    table from registry│
└───────────────────────┘
```

Key constraints:

- The registry describes **what** to ingest into, not **how** to analyze the data after ingestion.
- Domain-specific analysis (PMO: RA calculation, HR: turnover) remains code-driven in the Shared Analysis Layer (6.3).
- Sample values can be static (stored in registry) or dynamic (fetched from DB at profiling time). Dynamic fetch is preferred for frequently-changing reference data (member names, project codes). Static is sufficient for stable enums (status codes, leave types).
- Column mappings are not always 1:1. The registry supports `column_transform_hints` for split (one sheet column → two DB columns), merge (two sheet columns → one DB column), and computed columns.

## 7. Major Modes and Their Meaning

### 7.1 `ingest_workbook`

Used when:

- user provides workbook
- user wants ingestion, validation, or publish

May end in:

- validation complete
- publish complete
- handoff to reporting workflow

### 7.2 `validate_only`

Used when:

- user wants workbook checked
- user does not want publish

May end in:

- validation log only
- optional follow-up re-plan into ingestion or reporting

### 7.3 `report_from_db`

Used when:

- user does not provide workbook
- user wants current-state reporting from published database data

Outputs:

- standardized RA-Timesheet dataset
- company-wide RA summary
- overbook and idle report
- mismatch report

### 7.4 `investigate_mismatches`

Used when:

- user wants focused anomaly investigation
- user wants PMO review support on specific periods, members, or projects

Outputs:

- categorized mismatch analysis
- edge-case exclusion reasoning
- follow-up list for PMO or line manager

### 7.5 `recommend_rebalance_actions`

Used when:

- user wants action proposals rather than raw report output

Outputs:

- PMO action suggestions
- line manager follow-up suggestions
- reasoned workload balancing proposals

## 8. Core Design Rules

### 8.1 Keep specialized workflow logic deterministic

The supervisor decides:

- which workflow to run
- in what order
- whether a second workflow is needed

But inside a workflow, logic should remain hardcoded and testable.

Example:

- overbook detection logic should not be invented by the LLM at runtime
- it should call deterministic code with known thresholds and exclusion rules

### 8.2 Re-plan only at major checkpoints

Allowed re-plan points:

- after ingestion validation
- after publish
- after report generation
- after investigation result synthesis

Not after every low-level handler step.

### 8.3 Persist reusable artifacts

Supervisor re-planning is only useful if outputs can be reused.

Required persisted artifacts include:

- confirmed mapping
- normalized staging summary
- validation log
- published dataset references
- reporting period
- generated report references
- alert summaries
- suggested action summaries

### 8.4 Separate request intent from execution path

The user goal is free-form.
The execution path must be normalized into structured PMO mode and workflow contract.

### 8.5 Separate generic ingestion from domain-specific analysis

The ingestion pipeline (profiling, table mapping, column mapping, normalization, publish) must be metadata-driven and domain-agnostic. It reads the Domain Schema Registry to know **what** to ingest into.

Domain-specific analysis (PMO: RA calculation, HR: turnover analysis) must remain code-driven in per-domain analysis modules. The schema registry does not describe analysis logic.

This separation means:

- adding a new ingestion target = admin registers table definitions in the schema registry
- adding new analysis = developer writes domain-specific analysis code and registers it as a workflow

### 8.6 Schema registry is the single source of truth for target schema knowledge

During ingestion, the profiling and mapping steps must read table and column definitions exclusively from the schema registry. No hardcoded table names or column semantics in the ingestion pipeline code.

Legacy PMO-specific knowledge (e.g. "column `ra_pct` is resource allocation percentage") must be migrated into the schema registry as column descriptions and validation rules.

## 9. New Top-Level Contracts

## 9.1 PMO request contract

Add a normalized PMO request schema such as:

```ts
interface PmoSupervisorRequest {
  tenantId: string;
  goal: string;
  reportingPeriod?: {
    key?: string;
    start?: string;
    end?: string;
  };
  sourceMode: 'workbook' | 'database' | 'hybrid';
  requestedOutcome:
    | 'ingest_and_publish'
    | 'validate_only'
    | 'generate_report'
    | 'investigate_alerts'
    | 'suggest_actions';
  sourceWorkbook?: {
    ingestionSessionId?: string;
    fileKey?: string;
  };
}
```

## 9.2 PMO supervisor plan contract

Add a major-phase plan schema such as:

```ts
interface PmoSupervisorPlan {
  plan_id: string;
  modes: Array<{
    mode_id: string;
    mode_type:
      | 'ingest_workbook'
      | 'validate_only'
      | 'report_from_db'
      | 'investigate_mismatches'
      | 'recommend_rebalance_actions';
    depends_on?: string[];
    requires_human_review: boolean;
    success_exit:
      | 'finish'
      | 'replan'
      | 'handoff_report'
      | 'handoff_investigation';
  }>;
}
```

## 9.3 PMO supervisor result contract

Define a structured result the supervisor can evaluate:

```ts
interface PmoModeResult {
  mode_id: string;
  mode_type: string;
  status: 'completed' | 'needs_review' | 'failed';
  producedArtifacts: string[];
  summary: string;
  suggestedNextMode?: string;
}
```

## 9.4 Domain Schema Registry contracts

Define the admin-managed table and column catalog:

```ts
interface DomainTableDefinition {
  id: string;
  tenant_id: string;
  domain_id: string;                // 'pmo' | 'hr' | 'finance'
  table_name: string;               // 'resource_allocation'
  schema_name: string;              // postgres schema name
  table_description: string;        // LLM-readable business description
  table_purpose: string;            // "Stores weekly resource allocation per member per project"
  common_sheet_names?: string[];    // ["RA", "Resource Allocation", "Phan bo"] — hints for table matching
  is_active: boolean;
  columns: DomainColumnDefinition[];
  created_at: string;
  updated_at: string;
}

interface DomainColumnDefinition {
  id: string;
  table_definition_id: string;
  column_name: string;              // DB column name
  column_description: string;       // "Unique employee identifier in the system"
  data_type: 'text' | 'numeric' | 'date' | 'boolean' | 'timestamp' | 'uuid';
  is_required: boolean;
  is_unique: boolean;
  is_primary_key: boolean;
  reference_lookup?: {
    target_table: string;           // logical reference, not FK — e.g. 'hr.employees'
    target_column: string;          // e.g. 'employee_id'
    lookup_display_column?: string; // e.g. 'full_name' — for user-facing display
  };
  enum_values?: string[];           // ['active', 'inactive', 'on_leave']
  validation_rules?: {
    pattern?: string;               // regex for format validation
    min?: number;
    max?: number;
    max_length?: number;
  };
  sample_values_mode: 'static' | 'dynamic' | 'none';
  static_sample_values?: string[];  // used when mode is 'static'
  column_transform_hints?: {
    type: 'split' | 'merge' | 'computed';
    source_columns?: string[];      // for merge: which sheet columns combine
    target_columns?: string[];      // for split: which DB columns result
    transform_description?: string; // LLM-readable hint for the mapping step
  };
  display_order: number;
}
```

Sample value fetch contract for dynamic mode:

```ts
interface SampleValueFetchRequest {
  tenant_id: string;
  schema_name: string;
  table_name: string;
  column_name: string;
  limit: number;                    // default 50, max 100
  distinct: boolean;                // default true
}

interface SampleValueFetchResult {
  column_name: string;
  values: string[];
  fetched_at: string;
  is_cached: boolean;
}
```

## 10. Step-by-Step Implementation Plan

### Step 1: Add PMO supervisor domain and schemas

#### Objective

Create explicit types and schemas for supervisor-level requests, plans, and results.

#### Files to add

- `packages/pmo/src/backend/supervisor/schemas.ts`
- `packages/pmo/src/backend/supervisor/types.ts`
- `packages/pmo/src/backend/supervisor/contracts.ts`

#### Files to update

- `packages/pmo/src/contracts.ts`
- `apps/web/src/modules/pmo/api/client.ts`

#### Logic changes

1. Define request schema for PMO supervisor input.
2. Define major-phase plan schema.
3. Define workflow mode enum.
4. Define result and artifact contracts.

#### Done when

- the system has a machine-readable PMO supervisor contract

### Step 2: Add PMO supervisor state persistence

#### Objective

Persist top-level PMO orchestration state across multiple workflows.

#### Files to update

- `packages/pmo/src/backend/db/schema.ts`
- new migration under `packages/pmo/drizzle/`

#### Suggested tables or columns

Option A:

- new table `pmo.supervisor_runs`

Option B:

- extend `ingestion_sessions` plus new generic PMO run table

Recommended shape:

```ts
supervisor_runs {
  id
  tenant_id
  created_by
  goal
  source_mode
  requested_outcome
  current_mode_id
  current_mode_type
  status
  plan_json
  artifact_index_json
  started_at
  updated_at
  finished_at
}
```

#### Logic changes

1. Persist one supervisor run per top-level PMO request.
2. Track current major mode.
3. Track produced artifacts.
4. Track whether re-plan is pending.

#### Done when

- a supervisor run can span multiple specialized workflows safely

### Step 3: Create Domain Schema Registry persistence and CRUD

#### Objective

Provide an admin-managed catalog of target tables and columns that the ingestion pipeline reads at runtime. This is the foundation for multi-domain extensibility.

#### Files to add

- `packages/core/src/schema-registry/schema.ts` — Drizzle table definitions for `core.domain_table_definitions` and `core.domain_column_definitions`
- `packages/core/src/schema-registry/repository.ts` — CRUD operations (create, read, update, delete, list by domain/tenant)
- `packages/core/src/schema-registry/types.ts` — TypeScript types matching contracts in Section 9.4
- `packages/core/src/schema-registry/index.ts` — public surface
- new migration under `packages/core/drizzle/`

#### Files to update

- `packages/core/src/index.ts` — export schema-registry public surface

#### DB schema

```sql
-- core.domain_table_definitions
CREATE TABLE core.domain_table_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  domain_id     text NOT NULL,            -- 'pmo', 'hr', 'finance'
  table_name    text NOT NULL,
  schema_name   text NOT NULL,
  table_description   text NOT NULL,
  table_purpose       text NOT NULL,
  common_sheet_names  jsonb DEFAULT '[]',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, schema_name, table_name)
);

-- core.domain_column_definitions
CREATE TABLE core.domain_column_definitions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_definition_id   uuid NOT NULL REFERENCES core.domain_table_definitions(id) ON DELETE CASCADE,
  column_name           text NOT NULL,
  column_description    text NOT NULL,
  data_type             text NOT NULL,
  is_required           boolean NOT NULL DEFAULT false,
  is_unique             boolean NOT NULL DEFAULT false,
  is_primary_key        boolean NOT NULL DEFAULT false,
  reference_lookup      jsonb,            -- { target_table, target_column, lookup_display_column }
  enum_values           jsonb,            -- ['active', 'inactive']
  validation_rules      jsonb,            -- { pattern, min, max, max_length }
  sample_values_mode    text NOT NULL DEFAULT 'none',
  static_sample_values  jsonb,
  column_transform_hints jsonb,           -- { type, source_columns, target_columns, transform_description }
  display_order         integer NOT NULL DEFAULT 0,
  UNIQUE (table_definition_id, column_name)
);
```

Note: this is a cross-schema FK (`core.domain_column_definitions` → `core.domain_table_definitions`) within the same `core` schema, which is allowed. The FK stays inside `core`.

#### Logic changes

1. Implement CRUD repository for table definitions (scoped by tenant).
2. Implement CRUD repository for column definitions (scoped by table definition).
3. Implement `listByDomain(tenantId, domainId)` — returns all active table definitions with columns for a given domain.
4. Implement `listAllActive(tenantId)` — returns all active table definitions across domains (for cross-domain profiling).
5. Add input validation: `domain_id` must be a known domain, `data_type` must be valid, `sample_values_mode` must be valid.

#### Done when

- admin can register, update, and deactivate table/column definitions
- ingestion pipeline can query the registry to get target schema metadata

### Step 4: Add dynamic sample value fetching

#### Objective

Allow the column mapping step to fetch real sample values from DB for columns marked as `sample_values_mode: 'dynamic'`.

#### Files to add

- `packages/core/src/schema-registry/sample-value-fetcher.ts`

#### Files to update

- `packages/core/src/schema-registry/index.ts`

#### Logic changes

1. Implement `fetchSampleValues(request: SampleValueFetchRequest)`:
   - read column definition from registry
   - if `sample_values_mode === 'static'`, return `static_sample_values`
   - if `sample_values_mode === 'dynamic'`, query target table for distinct values (limit 50-100)
   - apply tenant scoping to the query
   - cache results with TTL (suggested: 1 hour for dev, 15 min for prod)
2. Implement batch fetch: `fetchSampleValuesForTable(tenantId, tableDefinitionId)` — fetches all dynamic columns at once.
3. Security: validate that the requesting user/tenant has access to the target schema before querying.

#### Done when

- column mapping step can get real DB values for comparison against sheet values
- static values are returned from registry without DB query
- dynamic values are fetched and cached

### Step 5: Refactor ingestion profiling and mapping to be metadata-driven

#### Objective

Make the profiling (sheet → table matching) and column mapping steps read from the Domain Schema Registry instead of using hardcoded PMO-specific knowledge.

#### Files to refactor

- `packages/pmo/src/backend/profiling/workbook-profiling.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/workbook-profiling.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/column-mapping.ts`

#### Files to add

- `packages/pmo/src/backend/ingestion/generic-table-matcher.ts` — matches sheet structure against registry table definitions
- `packages/pmo/src/backend/ingestion/generic-column-mapper.ts` — maps sheet columns to registry column definitions using descriptions + sample values

#### Logic changes

1. **Table matching** (profiling step):
   - read all active table definitions from registry for the tenant
   - compare sheet headers, sheet name, and sample rows against table descriptions, column descriptions, and `common_sheet_names`
   - use LLM or scoring algorithm to rank candidate tables
   - return ranked matches with confidence scores
   - present top match to user for review

2. **Column mapping** step:
   - after user approves table match, load column definitions for the matched table
   - fetch sample values (static or dynamic) for all columns
   - compare sheet headers against column descriptions and sample values
   - use LLM or scoring algorithm to suggest column mappings
   - handle `column_transform_hints` for split/merge/computed columns
   - present suggested mapping to user for review

3. **Normalization** step:
   - read `validation_rules` from registry column definitions
   - apply `is_required`, `data_type`, `enum_values`, `validation_rules.pattern`, etc.
   - resolve `reference_lookup` by querying the referenced table
   - report validation errors with column descriptions for context

4. **Backward compatibility**:
   - seed the schema registry with existing PMO table definitions on first run or migration
   - existing PMO ingestion runs that started before migration continue to work with legacy logic
   - new runs use registry-based logic

#### Done when

- profiling and column mapping work for any domain registered in the schema registry
- PMO-specific hardcoded knowledge is fully replaced by registry entries
- adding an HR table definition in the registry makes HR sheet ingestion work without code changes

### Step 6: Add admin UI for schema registry management

#### Objective

Provide a web interface for admins to manage table and column definitions.

#### Files to add

- `apps/web/src/modules/admin/pages/schema-registry-page.tsx`
- `apps/web/src/modules/admin/pages/schema-registry-page.logic.ts`
- `apps/web/src/modules/admin/components/table-definition-form.tsx`
- `apps/web/src/modules/admin/components/column-definition-form.tsx`
- `apps/web/src/modules/admin/components/schema-registry-list.tsx`

#### Files to update

- `apps/web/src/routes.ts` — add admin route
- `packages/core/src/schema-registry/index.ts` — ensure HTTP-facing functions are exported

#### Logic changes

1. List all table definitions for the tenant, grouped by domain.
2. Add/edit table definition form:
   - domain, table name, schema, description, purpose, common sheet names
3. Add/edit column definition form:
   - column name, description, data type, required/unique/PK flags
   - enum values editor
   - validation rules editor (pattern, min, max, max_length)
   - reference lookup configuration
   - sample values mode selector (static/dynamic/none)
   - static sample values editor
   - column transform hints editor
4. Deactivate/reactivate table definitions.
5. Preview: show what the LLM/profiling step would see for a given table definition.

#### Done when

- admin can fully manage schema registry from the web UI
- no CLI or direct DB access needed to onboard a new domain

### Step 7: Implement PMO supervisor planner

#### Objective

Generate a major-phase plan from user goal and available context.

#### Files to add

- `packages/pmo/src/backend/supervisor/generate-supervisor-plan.ts`
- `packages/pmo/src/backend/supervisor/plan-schema.ts`

#### Files to reuse

- `packages/pmo/src/backend/planning/generate-plan.ts`

#### Logic changes

1. Build a new planner prompt for supervisor-level planning.
2. The prompt must decide:
   - workbook vs DB mode
   - whether ingestion is needed
   - whether publish is in scope
   - whether report generation is the final output
   - whether investigation should happen after report generation
3. Normalize planner output into a strict major-phase plan.

#### Done when

- free-form PMO request can be converted into a valid supervisor plan

### Step 8: Implement PMO supervisor workflow

#### Objective

Create the top-level orchestration workflow.

#### Files to add

- `packages/pmo/src/backend/workflows/pmo-supervisor/spec.ts`
- `packages/pmo/src/backend/workflows/pmo-supervisor/orchestrator.ts`
- `packages/pmo/src/backend/workflows/pmo-supervisor/schemas.ts`

#### Files to update

- `packages/pmo/src/backend/workflows/index.ts`
- `packages/pmo/src/backend/workflows/start-ingest.ts`
- `packages/pmo/src/register.ts`

#### Logic changes

The supervisor workflow should:

1. receive normalized PMO request
2. load or generate major-phase plan
3. dispatch the first mode
4. wait for the specialized mode result
5. evaluate result
6. either:
   - finish
   - request human review
   - re-plan
   - dispatch the next mode

#### Done when

- a PMO request can launch the right specialized workflow automatically

### Step 9: Add workflow dispatch layer

#### Objective

Map PMO mode types to concrete specialized workflows.

#### Files to add

- `packages/pmo/src/backend/supervisor/workflow-dispatch.ts`

#### Logic changes

Dispatch map example:

```ts
{
  ingest_workbook: 'pmo.ingestData.v2',
  validate_only: 'pmo.ingestData.v2',
  report_from_db: 'pmo.generateReport.v1',
  investigate_mismatches: 'pmo.investigateAlerts.v1',
  recommend_rebalance_actions: 'pmo.recommendActions.v1'
}
```

`validate_only` can reuse ingestion workflow with a mode-specific planner blueprint that stops before publish.

#### Done when

- supervisor can launch specialized workflows without hardcoding mode logic everywhere

### Step 10: Build DB-based report workflow

#### Objective

Support reporting without ingestion.

#### Files to add

- `packages/pmo/src/backend/workflows/generate-report/spec.ts`
- `packages/pmo/src/backend/workflows/generate-report/schemas.ts`
- `packages/pmo/src/backend/workflows/generate-report/build-member-project-week.ts`
- `packages/pmo/src/backend/workflows/generate-report/generate-ra-summary.ts`
- `packages/pmo/src/backend/workflows/generate-report/detect-overbook-idle.ts`
- `packages/pmo/src/backend/workflows/generate-report/compare-ra-vs-timesheet.ts`

#### Logic changes

This workflow should:

1. read already-published canonical PMO tables
2. assemble common Member-Project-Week dataset
3. calculate:
   - member project allocation
   - total RA%
   - actual logged effort
4. detect:
   - overbook
   - idle
   - mismatch classes
5. apply exclusions:
   - leave
   - holiday
   - training
   - approved OT
6. emit report artifacts

#### Done when

- user can ask for PMO report without uploading workbook

### Step 11: Build alert investigation workflow

#### Objective

Support focused anomaly investigation from DB.

#### Files to add

- `packages/pmo/src/backend/workflows/investigate-alerts/spec.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/schemas.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/classify-mismatches.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/explain-edge-cases.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/suggest-followups.ts`

#### Logic changes

This workflow should:

1. accept scope:
   - period
   - project
   - member
   - alert type
2. pull relevant normalized/published data
3. classify mismatch types:
   - RA > logged
   - logged > RA
   - possible overbook
   - possible idle
4. explain excluded cases
5. produce focused PMO review summary

#### Done when

- PMO can ask targeted questions without re-running ingestion

### Step 12: Build recommendation workflow

#### Objective

Turn PMO analysis into structured suggested actions.

#### Files to add

- `packages/pmo/src/backend/workflows/recommend-actions/spec.ts`
- `packages/pmo/src/backend/workflows/recommend-actions/schemas.ts`
- `packages/pmo/src/backend/workflows/recommend-actions/build-recommendations.ts`

#### Logic changes

This workflow should transform reports and investigations into:

- PMO follow-up list
- line manager action suggestions
- member/project rebalance candidates
- human-reviewable justification

Keep recommendation logic deterministic where possible:

- thresholds
- classification rules
- exclusion policy

Use LLM only for:

- summarization
- wording
- grouping and prioritization if needed

#### Done when

- system can output suggested actions, not just raw mismatches

### Step 13: Add bounded re-plan policy

#### Objective

Allow supervisor to decide the next major phase after a workflow finishes.

#### Files to add

- `packages/pmo/src/backend/supervisor/replan-policy.ts`
- `packages/pmo/src/backend/supervisor/evaluate-mode-result.ts`

#### Logic changes

Examples:

1. `ingest_workbook` completed with publish:
   - re-plan into `report_from_db`

2. `validate_only` completed:
   - finish
   - or wait for PMO decision to continue into ingestion

3. `report_from_db` completed with severe overbook alerts:
   - re-plan into `investigate_mismatches`

4. `investigate_mismatches` completed:
   - re-plan into `recommend_rebalance_actions`

Important rule:

- re-plan must be explicit and policy-bounded
- do not let the supervisor invent arbitrary new workflow kinds

#### Done when

- the system can chain major PMO phases without becoming unpredictable

### Step 14: Extend PMO web UI for supervisor runs

#### Objective

Make PMO page able to show both supervisor-level and specialized workflow state.

#### Files to update

- `apps/web/src/modules/pmo/pages/pmo-page.tsx`
- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`
- `apps/web/src/modules/pmo/components/pmo-plan-section.tsx`
- `apps/web/src/modules/pmo/components/pmo-workflow-execution-section.tsx`
- new components:
  - `apps/web/src/modules/pmo/components/pmo-supervisor-plan-panel.tsx`
  - `apps/web/src/modules/pmo/components/pmo-mode-summary-panel.tsx`

#### Logic changes

UI should show:

1. top-level PMO request mode
2. supervisor plan
3. current specialized workflow
4. produced artifacts
5. whether re-plan is pending
6. final output mode:
   - report
   - validation log
   - publish complete
   - action recommendations

#### Done when

- PMO page explains the whole supervisor journey, not just one workflow run

### Step 15: Add report and artifact persistence

#### Objective

Store reports and analysis outputs so they can be reused by follow-up modes.

#### Files to update

- `packages/pmo/src/backend/db/schema.ts`
- new migration files

#### Suggested storage

- `pmo.report_runs`
- `pmo.report_artifacts`
- `pmo.alert_investigations`
- `pmo.recommendation_sets`

#### Logic changes

Persist:

- standardized report dataset reference
- overbook and idle summary
- mismatch report summary
- suggested actions summary

Store artifact pointers rather than huge JSON blobs when possible.

#### Done when

- re-plan can reuse prior outputs without recomputing everything

### Step 16: Add tests for multi-mode PMO agent and schema registry

#### Objective

Protect the supervisor and mode dispatch architecture.

#### Files to add or update

- `packages/core/tests/unit/schema-registry/*.test.ts`
- `packages/core/tests/integration/schema-registry/*.test.ts`
- `packages/pmo/tests/unit/supervisor/*.test.ts`
- `packages/pmo/tests/unit/ingestion/generic-table-matcher.test.ts`
- `packages/pmo/tests/unit/ingestion/generic-column-mapper.test.ts`
- `packages/pmo/tests/integration/*supervisor*.test.ts`
- `packages/pmo/tests/integration/*metadata-driven-ingestion*.test.ts`
- `apps/web/tests/unit/modules/pmo/*.test.tsx`
- `apps/web/tests/unit/modules/admin/schema-registry*.test.tsx`

#### Required scenarios

Schema registry:

1. Admin creates table definition with columns — persisted correctly.
2. Admin updates column description — profiling reads updated value.
3. Admin deactivates table — profiling no longer matches against it.
4. Dynamic sample values fetched and cached correctly.
5. Static sample values returned from registry without DB query.

Metadata-driven ingestion:

6. Sheet uploaded against a PMO table registered in registry — table matched correctly.
7. Sheet uploaded against an HR table registered in registry — table matched correctly without code changes.
8. Column mapping uses registry descriptions + sample values — suggests correct mapping.
9. Column with `column_transform_hints` (split/merge) handled correctly.
10. Normalization applies `validation_rules` from registry.
11. Reference lookup resolved via `reference_lookup` definition.

Supervisor and modes:

12. Workbook + publish request routes to ingestion workflow.
13. DB-only report request routes to report workflow.
14. Validation-only request stops before publish.
15. Publish complete triggers re-plan into report mode.
16. Severe mismatch report triggers re-plan into investigation mode.
17. Investigation result triggers recommendation mode.
18. Human review blocks phase transition until approval.
19. Legacy ingestion-only flows still work.

#### Done when

- a developer can safely extend modes without breaking routing or re-plan logic
- a new domain can be onboarded by registering table definitions and verified by integration tests

### Step 17: Add rollout and migration strategy

#### Objective

Ship Phase 3 without destabilizing Phase 2.

#### Files to update

- `packages/pmo/src/backend/http/routes.ts`
- `packages/pmo/src/backend/workflows/start-ingest.ts`
- runtime config and env docs

#### Recommended feature flags

- `SCHEMA_REGISTRY_ENABLED`
- `METADATA_DRIVEN_INGESTION_ENABLED`
- `PMO_SUPERVISOR_ENABLED`
- `PMO_REPORT_FROM_DB_ENABLED`
- `PMO_ALERT_INVESTIGATION_ENABLED`
- `PMO_RECOMMEND_ACTIONS_ENABLED`

#### Rollout sequence

1. merge behind flags
2. enable schema registry and seed PMO table definitions
3. enable metadata-driven ingestion for PMO (replaces hardcoded profiling/mapping)
4. verify PMO ingestion works identically with registry-based logic
5. enable supervisor with ingestion-only delegation
6. enable DB report mode
7. enable investigation mode
8. enable recommendation mode
9. enable bounded re-plan

#### Done when

- supervisor path is production-safe and reversible

## 11. File Inventory Summary

### New files

Domain Schema Registry (core):

- `packages/core/src/schema-registry/schema.ts`
- `packages/core/src/schema-registry/repository.ts`
- `packages/core/src/schema-registry/types.ts`
- `packages/core/src/schema-registry/sample-value-fetcher.ts`
- `packages/core/src/schema-registry/index.ts`
- new migration under `packages/core/drizzle/`

Generic ingestion (pmo, extractable later):

- `packages/pmo/src/backend/ingestion/generic-table-matcher.ts`
- `packages/pmo/src/backend/ingestion/generic-column-mapper.ts`

Admin UI:

- `apps/web/src/modules/admin/pages/schema-registry-page.tsx`
- `apps/web/src/modules/admin/pages/schema-registry-page.logic.ts`
- `apps/web/src/modules/admin/components/table-definition-form.tsx`
- `apps/web/src/modules/admin/components/column-definition-form.tsx`
- `apps/web/src/modules/admin/components/schema-registry-list.tsx`

Supervisor:

- `packages/pmo/src/backend/supervisor/schemas.ts`
- `packages/pmo/src/backend/supervisor/types.ts`
- `packages/pmo/src/backend/supervisor/contracts.ts`
- `packages/pmo/src/backend/supervisor/generate-supervisor-plan.ts`
- `packages/pmo/src/backend/supervisor/workflow-dispatch.ts`
- `packages/pmo/src/backend/supervisor/replan-policy.ts`
- `packages/pmo/src/backend/supervisor/evaluate-mode-result.ts`
- `packages/pmo/src/backend/workflows/pmo-supervisor/spec.ts`
- `packages/pmo/src/backend/workflows/pmo-supervisor/orchestrator.ts`
- `packages/pmo/src/backend/workflows/pmo-supervisor/schemas.ts`

Specialized workflows:

- `packages/pmo/src/backend/workflows/generate-report/spec.ts`
- `packages/pmo/src/backend/workflows/generate-report/schemas.ts`
- `packages/pmo/src/backend/workflows/generate-report/build-member-project-week.ts`
- `packages/pmo/src/backend/workflows/generate-report/generate-ra-summary.ts`
- `packages/pmo/src/backend/workflows/generate-report/detect-overbook-idle.ts`
- `packages/pmo/src/backend/workflows/generate-report/compare-ra-vs-timesheet.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/spec.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/schemas.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/classify-mismatches.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/explain-edge-cases.ts`
- `packages/pmo/src/backend/workflows/investigate-alerts/suggest-followups.ts`
- `packages/pmo/src/backend/workflows/recommend-actions/spec.ts`
- `packages/pmo/src/backend/workflows/recommend-actions/schemas.ts`
- `packages/pmo/src/backend/workflows/recommend-actions/build-recommendations.ts`
- `apps/web/src/modules/pmo/components/pmo-supervisor-plan-panel.tsx`
- `apps/web/src/modules/pmo/components/pmo-mode-summary-panel.tsx`

### Existing files that must change

- `packages/core/src/index.ts` — export schema-registry
- `packages/pmo/src/backend/db/schema.ts`
- `packages/pmo/src/backend/http/routes.ts`
- `packages/pmo/src/backend/workflows/index.ts`
- `packages/pmo/src/backend/workflows/start-ingest.ts`
- `packages/pmo/src/backend/planning/plan-schema.ts`
- `packages/pmo/src/backend/planning/generate-plan.ts`
- `packages/pmo/src/backend/planning/step-metadata.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/spec.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/workbook-profiling.ts`
- `packages/pmo/src/backend/workflows/ingest-data-v2/handlers/column-mapping.ts`
- `packages/pmo/src/backend/profiling/workbook-profiling.ts`
- `packages/pmo/src/contracts.ts`
- `apps/web/src/modules/pmo/api/client.ts`
- `apps/web/src/modules/pmo/pages/pmo-page.tsx`
- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`
- `apps/web/src/modules/pmo/components/pmo-plan-section.tsx`
- `apps/web/src/modules/pmo/components/pmo-workflow-execution-section.tsx`
- `apps/web/src/routes.ts` — add admin schema registry route

## 12. Explicit Non-Goals

Phase 3 should not try to do these at the same time:

- replace deterministic PMO business rules with free-form LLM reasoning
- remove Phase 2 ingestion runtime
- redesign the whole PMO frontend from scratch
- generalize every non-PMO workflow in the platform to this architecture
- introduce unrestricted autonomous re-planning
- build domain-specific analysis for non-PMO domains (HR analysis, Finance analysis) — only the ingestion pipeline is made generic; analysis stays per-domain and is a future effort
- extract the generic ingestion framework into its own package — it lives in `pmo` for now, extraction is a future refactor when a second domain is actively used

## 13. Success Criteria

Phase 3 is complete when all of the following are true:

Domain Schema Registry and ingestion extensibility:

1. Admin can register table and column definitions for any domain via the web UI.
2. Profiling step reads the schema registry to match uploaded sheets to target tables — no hardcoded table names in ingestion code.
3. Column mapping step uses column descriptions and sample values (static or dynamic) from the registry to suggest mappings.
4. Normalization step applies validation rules from the registry.
5. Adding a new domain (e.g. HR) requires only registering table definitions — no new ingestion code.
6. Existing PMO ingestion works identically after migration to registry-based logic.

Supervisor and multi-mode orchestration:

7. A user can request PMO output with or without workbook ingestion.
8. The supervisor chooses the right workflow mode from structured intent.
9. Specialized workflows stay deterministic and reusable.
10. The system can re-plan between major phases in a bounded way.
11. PMO page can show supervisor state, specialized workflow state, and resulting artifacts.
12. Reports, alerts, and recommendations can be generated from DB without forcing ingestion.
13. Human review still blocks progression where business control is required.