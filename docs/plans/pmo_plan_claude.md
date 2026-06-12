# PMO Allocation Intelligence — Implementation Plan

Agentic resource allocation & timesheet monitoring flow.
Each step depends only on outputs from earlier steps. No forward references.

---

## Step 0: Module scaffold

**What:** Generate the `pmo` module skeleton using the repo's generator.

```bash
pnpm gen module
# name: pmo
# tier: feature
# web companion: Y
```

**Produces:**
- `packages/pmo/` with `package.json`, `tsconfig.json`, `drizzle.config.ts`
- `src/register.ts` (empty `reg.module({ name: 'pmo', ... })`)
- `src/backend/db/schema.ts` (empty pgSchema `pmo`)
- `drizzle/` migrations directory
- Nav manifest stub in `apps/web/`

**Verify:** `pnpm typecheck --filter @seta/pmo`

---

## Step 1: Data model — PMO tables

**Depends on:** Step 0 (schema.ts exists)

**What:** Define core tables in `packages/pmo/src/backend/db/schema.ts`:

```
pmo.ingestion_sessions
  - id, tenant_id, status (detected | awaiting_confirmation | confirmed | failed)
  - source_file_key (S3 key), source_file_name, mime_type
  - detected_schema (jsonb: column names, inferred types, sample values)
  - confirmed_mapping (jsonb: column → canonical field mapping)
  - created_by, created_at, confirmed_at

pmo.resource_allocations
  - id, tenant_id, ingestion_session_id
  - member_id (uuid, no FK to identity), project_id, plan_id
  - start_date, end_date, allocation_pct, hours_planned
  - created_at, updated_at

pmo.timesheets
  - id, tenant_id, ingestion_session_id
  - member_id, project_id, date, hours_logged, category
  - created_at

pmo.rules_config
  - id, tenant_id
  - rule_type (overbook_threshold | idle_threshold | mismatch_tolerance | ...)
  - params (jsonb), active, created_by
```

**Run:**
```bash
pnpm --filter @seta/pmo db:generate
pnpm db:migrate
```

**Verify:** `docker exec seta-ap-postgres-dev psql -U seta -d seta -c '\dt pmo.*'`

---

## Step 2: Events & RBAC declarations

**Depends on:** Step 1 (tables exist for context)

**What:** Create `packages/pmo/src/events.ts` and `packages/pmo/src/rbac.ts`:

Events:
```
pmo.ingestion.schema_detected
pmo.ingestion.mapping_confirmed
pmo.ingestion.normalization_complete
pmo.ingestion.validation_failed
pmo.analysis.overbook_detected
pmo.analysis.idle_detected
pmo.analysis.mismatch_detected
pmo.action.rebalance_requested
pmo.action.notification_sent
```

RBAC permissions:
```
pmo.ingestion.upload
pmo.ingestion.confirm_mapping
pmo.data.read.self / .tenant
pmo.analysis.run
pmo.rules.manage
pmo.action.execute
```

Wire into `register.ts`:
```ts
reg.module({
  name: 'pmo',
  schema,
  events: PMO_EVENTS,
  rbac: pmoRbac,
  ...
});
```

**Verify:** `pnpm typecheck && pnpm lint`

---

## Step 3: Structured file parsing

**Depends on:** Step 1 (ingestion_sessions table)

**What:** Create `packages/pmo/src/backend/ingestion/parse-structured.ts`

The existing knowledge parsers (`csv.ts`, `xlsx.ts`) normalize to flat text. PMO needs structured output:

```ts
interface StructuredSheet {
  sheetName: string;
  headers: string[];              // first row
  sampleRows: Record<string, string>[]; // first N rows (e.g. 5)
  rowCount: number;
  columnStats: Array<{
    name: string;
    nonEmptyCount: number;
    sampleValues: string[];       // first 3 unique non-empty
    inferredType: 'date' | 'number' | 'text' | 'uuid';
  }>;
}
```

This layer uses ExcelJS (already a dep in knowledge) to read XLSX into structured metadata, not flatten into text.

**Does NOT** import from `packages/knowledge` — duplicating the ExcelJS read is cheaper than coupling modules. CSV uses `csv-parse` (new dep: `pnpm --filter @seta/pmo add csv-parse`).

**Verify:** Unit test with fixture file → assert headers + columnStats output.

---

## Step 4: Schema detection & mapping inference

**Depends on:** Step 3 (StructuredSheet available)

**What:** Create `packages/pmo/src/backend/ingestion/detect-schema.ts`

Deterministic (no LLM) mapping logic:
1. Read `StructuredSheet.headers` + `columnStats`
2. Match each header against a canonical field dictionary:
   ```
   CANONICAL_FIELDS = {
     member: ['name', 'member', 'resource', 'employee', 'staff'],
     project: ['project', 'project_name', 'project_id'],
     hours_planned: ['planned', 'allocated', 'budget_hours', 'plan_hrs'],
     hours_logged: ['actual', 'logged', 'timesheet_hrs', 'worked'],
     date: ['date', 'week', 'period', 'start_date'],
     allocation_pct: ['allocation', 'alloc_%', 'percentage', '%'],
     ...
   }
   ```
3. Score each candidate by: fuzzy string similarity + column type compatibility
4. Output `DetectedMapping[]`:
   ```ts
   { sourceColumn: string; canonicalField: string; confidence: number }
   ```
5. If any required field has confidence < threshold → `status = 'awaiting_confirmation'`

**Persist** result into `pmo.ingestion_sessions.detected_schema`.

**Verify:** Unit test with sample headers → correct mapping output.

---

## Step 5: Evented workflow — ingestion with HITL confirm-mapping

**Depends on:** Step 3, Step 4 (parse + detect logic), Step 2 (events)

**What:** Create `packages/pmo/src/backend/workflows/ingest-data/spec.ts`

Follow the proven pattern from `planner/workflows/assign-by-skill/spec.ts`:

```ts
import { createWorkflow } from '@mastra/core/workflows/evented';
import { createStep } from '@mastra/core/workflows';

// Step 1: Parse + detect
const detectStep = createStep({
  id: 'pmo.ingest.detect',
  inputSchema: IngestInputSchema,     // { ingestionSessionId, fileKey }
  outputSchema: DetectOutputSchema,   // { sessionId, detectedMapping[], needsConfirmation }
  execute: async ({ inputData, requestContext }) => {
    // call parse-structured + detect-schema
    // persist to ingestion_sessions
    // emit pmo.ingestion.schema_detected
  },
});

// Step 2: HITL — suspend if mapping needs confirmation
const confirmStep = createStep({
  id: 'pmo.ingest.confirm',
  inputSchema: DetectOutputSchema,
  outputSchema: ConfirmOutputSchema,  // { sessionId, confirmedMapping }
  suspendSchema: MappingCardSchema,   // approval card showing proposed mapping
  resumeSchema: MappingDecisionSchema, // user confirms/modifies mapping
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      if (!inputData.needsConfirmation) {
        // High-confidence → auto-confirm, no HITL
        return { sessionId: inputData.sessionId, confirmedMapping: inputData.detectedMapping };
      }
      // Low confidence → suspend, show mapping card to user
      return suspend(buildMappingCard(inputData));
    }
    // User confirmed/modified → continue
    return { sessionId: inputData.sessionId, confirmedMapping: resumeData.mapping };
  },
});

// Step 3: Normalize — transform raw rows into canonical tables
const normalizeStep = createStep({
  id: 'pmo.ingest.normalize',
  inputSchema: ConfirmOutputSchema,
  outputSchema: NormalizeOutputSchema,
  execute: async ({ inputData }) => {
    // Read raw file again, apply confirmedMapping, write to pmo.resource_allocations / timesheets
    // emit pmo.ingestion.normalization_complete
  },
});

export const ingestDataWorkflow = createWorkflow({
  id: 'pmo.ingestData',
  inputSchema: IngestInputSchema,
  outputSchema: NormalizeOutputSchema,
  retryConfig: { attempts: 2, delay: 1000 },
})
  .then(detectStep)
  .then(confirmStep)   // ← suspend here if low confidence
  .then(normalizeStep) // ← resumes directly here after user confirm
  .commit();
```

**Key behavior:** After user confirms mapping → `run.resume()` enters `confirmStep` with `resumeData` populated → returns immediately → pipeline proceeds to `normalizeStep`. Detection step does NOT re-run.

Register in `WorkflowSpec`:
```ts
export const ingestDataWorkflowSpec: WorkflowSpec = {
  domain: 'pmo',
  id: 'ingestData',
  workflow: ingestDataWorkflow,
  hitlSteps: ['pmo.ingest.confirm'],
  ...
};
```

**Wire:** Add to `packages/pmo/src/backend/workflows/index.ts` as `WorkflowContribution[]` and register via `reg.module({ workflows: [...] })`.

**Verify:** Integration test — run workflow with low-confidence fixture → assert it suspends → resume with mapping → assert normalize step writes rows.

---

## Step 6: Data validation layer

**Depends on:** Step 5 (normalize step writes data)

**What:** Create `packages/pmo/src/backend/domain/validate-data.ts`

Post-normalization validation rules (deterministic, no LLM):
- Duplicate row detection (same member + project + date)
- Allocation % > 100% per member per week (overbook at ingestion time)
- Date range sanity (future dates beyond threshold, past dates beyond retention)
- Required field completeness

Output: `ValidationResult[]` with severity (`error | warning | info`).

On errors: update `ingestion_sessions.status = 'failed'`, emit `pmo.ingestion.validation_failed`.
On pass: leave status as `confirmed`.

Can be wired as a 4th step in the workflow (`validateStep` after `normalizeStep`), or called separately. Recommend adding to the workflow:

```
.then(detectStep)
.then(confirmStep)
.then(normalizeStep)
.then(validateStep)
.commit();
```

**Verify:** Unit tests with invalid data fixtures.

---

## Step 7: Deterministic analytics (Rule Engine)

**Depends on:** Step 1 (tables with data), Step 6 (validated data)

**What:** Create `packages/pmo/src/backend/analytics/`:

```
capacity-calculator.ts     — sum allocations per member per week
overbook-detector.ts       — allocation > threshold (from rules_config)
idle-detector.ts           — allocation < idle_threshold
mismatch-detector.ts       — |hours_planned - hours_logged| > tolerance
ra-percentage.ts           — actual utilization rate computation
```

All pure functions: `(data[], rules_config) → AnalysisResult[]`

No LLM involvement — these are arithmetic computations.

**Verify:** Unit tests with known inputs → assert exact numeric outputs.

---

## Step 8: Agent tools (read-only first)

**Depends on:** Step 7 (analytics functions), Step 4 (detect-schema for inspect tool)

**What:** Create `packages/pmo/src/backend/agent-tools/`:

```ts
// inspect-data.ts — "show me the current allocation for project X"
pmo_inspectAllocations: AgentTool

// detect-anomalies.ts — "are there any overbooked resources this week?"
pmo_detectAnomalies: AgentTool

// run-analysis.ts — "give me a summary of RA vs timesheet mismatches"
pmo_runAnalysis: AgentTool

// get-ingestion-status.ts — "what's the status of my last upload?"
pmo_getIngestionStatus: AgentTool
```

All read-only tools (`needsApproval: false`). They call the Step 7 analytics functions internally.

Register in `register.ts`:
```ts
reg.module({
  ...
  agentTools: pmoAgentTools,
});
```

**Verify:** `pnpm typecheck` + tool schema validation test.

---

## Step 9: Agent tools (write actions with HITL)

**Depends on:** Step 8 (read tools working), Step 5 (workflow registered)

**What:** Add write tools that require human approval:

```ts
// start-ingestion.ts — triggers the ingest workflow
pmo_startIngestion: AgentTool  // needsApproval: true

// recommend-rebalance.ts — proposes reallocation
pmo_recommendRebalance: AgentTool  // needsApproval: true

// request-timesheet-update.ts — sends notification to member
pmo_requestTimesheetUpdate: AgentTool  // needsApproval: true
```

Write tools use `needsApproval: true` (existing HITL pattern — user sees confirmation card before execution).

For `pmo_startIngestion`: triggers `ingestDataWorkflow` via the existing `/api/agent/v1/workflows/runs/:workflowId/start` endpoint pattern.

**Verify:** Integration test — agent invokes tool → approval card appears → user approves → action executes.

---

## Step 10: Subscribers (event-driven reactions)

**Depends on:** Step 2 (events declared), Step 7 (analytics), Step 9 (action tools)

**What:** Create `packages/pmo/src/backend/subscribers/`:

```ts
// on-normalization-complete.ts
// Trigger: pmo.ingestion.normalization_complete
// Action: auto-run overbook + idle + mismatch detection on newly ingested data

// on-anomaly-detected.ts
// Trigger: pmo.analysis.overbook_detected / idle_detected / mismatch_detected
// Action: create notification via @seta/notifications event bridge
```

Subscribers are idempotent (keyed on event_id per repo convention).

Register via `reg.module({ subscribers: pmoSubscribers() })`.

**Verify:** Integration test — emit event → subscriber fires → side effect observed.

---

## Step 11: HTTP routes (upload endpoint + dashboard API)

**Depends on:** Step 3 (parse), Step 5 (workflow), Step 7 (analytics)

**What:** Create `packages/pmo/src/backend/http/`:

```ts
// upload.ts — POST /api/pmo/v1/upload
// Presigned URL flow (same pattern as knowledge/chat-attachments):
//   1. Client requests presigned PUT URL
//   2. Client uploads directly to S3
//   3. Client calls POST /confirm-upload with file key
//   4. Server creates ingestion_session, starts ingest workflow

// dashboard.ts — GET /api/pmo/v1/dashboard
// Returns current period's capacity, overbooks, mismatches for tenant

// allocations.ts — GET/POST /api/pmo/v1/allocations
// CRUD for manual allocation edits (non-ingestion path)
```

Mount via `reg.module({ routes: { mountAt: '/', build: buildPmoRoutes } })`.

**Verify:** `pnpm typecheck` + route integration tests.

---

## Step 12: Web UI — Dashboard + Ingestion wizard

**Depends on:** Step 11 (HTTP API), Step 5 (workflow produces approval cards)

**What:** In `apps/web/src/modules/pmo/`:

```
pages/
  dashboard-page.tsx        — summary cards: capacity, overbook alerts, mismatch count
  ingestion-page.tsx        — upload wizard + mapping confirmation UI
  allocations-page.tsx      — table view with filters
components/
  mapping-confirmation.tsx  — renders the approval card for column mapping HITL
  anomaly-alert.tsx         — overbook/idle/mismatch alert cards
  capacity-chart.tsx        — weekly capacity visualization
```

The mapping-confirmation component renders the `MappingCardSchema` approval card from Step 5. When user modifies mapping → calls decide-approval endpoint → workflow resumes.

Leverages existing:
- Workflow approval card rendering (already in agent module UI)
- SSE run notifications (real-time status for ingestion progress)
- Existing TanStack Router patterns

**Verify:** `pnpm --filter @seta/web typecheck && pnpm test:e2e`

---

## Step 13: Wire into server + worker boot

**Depends on:** All previous steps

**What:** 

In `apps/server/src/index.ts`:
```ts
import { registerPmoContributions } from '@seta/pmo';
registerPmoContributions(registry);
```

In `apps/worker/src/index.ts`:
- PMO subscribers auto-registered via contribution registry

In `packages/agent/src/register.ts`:
- PMO tools auto-discovered via `agentTools` contribution
- PMO workflow spec auto-registered via `workflows` contribution

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm depcruise  # ensure no cross-module violations
```

---

## Dependency graph (visual)

```
Step 0: scaffold
  └─ Step 1: tables
       ├─ Step 2: events + RBAC
       ├─ Step 3: structured parsing
       │    └─ Step 4: schema detection
       │         └─ Step 5: evented workflow (HITL)
       │              ├─ Step 6: validation
       │              │    └─ Step 7: analytics
       │              │         ├─ Step 8: read tools
       │              │         │    └─ Step 9: write tools (HITL)
       │              │         └─ Step 10: subscribers
       │              └─ Step 11: HTTP routes
       │                   └─ Step 12: web UI
       └─────────────────────── Step 13: boot wiring
```

---

## Clarification loop behavior (the key question)

The flow for non-standard format documents:

```
User uploads file
  → detectStep runs (parse headers, infer mapping)
  → confidence < threshold?
      YES → confirmStep suspends workflow
           → approval card rendered in UI (shows proposed mapping + alternatives)
           → user modifies/confirms
           → decide-approval endpoint called
           → run.resume({ mapping: confirmedMapping })
           → confirmStep re-enters with resumeData populated
           → returns confirmedMapping
           → normalizeStep runs directly (no re-parse, no re-detect)
      NO  → confirmStep auto-passes (high confidence)
           → normalizeStep runs
```

This is NOT replay-from-step (which re-runs from a step on the same run). This is native Mastra suspend/resume — the workflow stays in memory/storage at the suspend point, and continues forward from exactly that point when resumed.

Key difference:
- **suspend/resume** = workflow paused at a step, continues forward from that step (what we use here)
- **replay-from-step** = workflow already completed/failed, user wants to re-execute from a specific step with new input (time-travel, in-place on same runId)
- **rerun** = start a brand new run with same/modified input (new runId)

---

## Estimated module shape (final)

```
packages/pmo/
├── drizzle/
├── src/
│   ├── register.ts
│   ├── events.ts
│   ├── rbac.ts
│   ├── backend/
│   │   ├── db/schema.ts
│   │   ├── ingestion/
│   │   │   ├── parse-structured.ts
│   │   │   └── detect-schema.ts
│   │   ├── domain/
│   │   │   ├── validate-data.ts
│   │   │   ├── normalize-data.ts
│   │   │   └── confirm-mapping.ts
│   │   ├── analytics/
│   │   │   ├── capacity-calculator.ts
│   │   │   ├── overbook-detector.ts
│   │   │   ├── idle-detector.ts
│   │   │   ├── mismatch-detector.ts
│   │   │   └── ra-percentage.ts
│   │   ├── workflows/
│   │   │   ├── index.ts
│   │   │   └── ingest-data/
│   │   │       ├── spec.ts
│   │   │       └── schemas.ts
│   │   ├── agent-tools/
│   │   │   ├── inspect-data.ts
│   │   │   ├── detect-anomalies.ts
│   │   │   ├── run-analysis.ts
│   │   │   ├── start-ingestion.ts
│   │   │   └── recommend-rebalance.ts
│   │   ├── subscribers/
│   │   │   ├── index.ts
│   │   │   ├── on-normalization-complete.ts
│   │   │   └── on-anomaly-detected.ts
│   │   └── http/
│   │       ├── index.ts
│   │       ├── upload.ts
│   │       └── dashboard.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```
