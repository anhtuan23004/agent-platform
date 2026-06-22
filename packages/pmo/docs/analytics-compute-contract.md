# PMO analytics compute contract

Calculation layer contract between **ingest/publish** and **utilization analytics/reporting**.

## Data flow

```text
publishUpsert -> pmo.* canonical (is_active=true)
       |
ensureFactsComputed(tenantId, { sessionId, force: true })
       |
pmo.member_week_facts (persisted read-model)
       |
       +-> loadFactsAndContext -> findings (on-demand demo)
       |        |
       |        +-> GET /api/pmo/v1/demo-analytics
       |
       +-> Report engine (Phase 1-8 pipeline)
                |
                +-> createReportRun (validate, snapshot rules, queue)
                +-> computeReportPayload (load bounded facts, classify, recommend)
                +-> renderReportHtml (deterministic A4 HTML)
                +-> renderReportPdf (headless Chromium, graphile worker)
                +-> upload artifacts to private S3
                +-> completeReportRun (persist hashes, emit event)
                |
                +-> GET /api/pmo/v1/reports/:id/download
```

## Ingest team (after publish)

`PMO_INGESTION_ADAPTER.publish` calls `ensureFactsComputed` with `force: true` immediately after `publishUpsert` succeeds. Manual calls are only needed for backfills or repair:

```ts
import { ensureFactsComputed } from '@seta/pmo/contracts';

await ensureFactsComputed(tenantId, {
  sessionId: ingestionSessionId,
  force: true,
});
```

Or HTTP:

```http
POST /api/pmo/v1/analytics/compute-facts
Content-Type: application/json

{ "ingestion_session_id": "<uuid>" }
```

This avoids latency on the first `GET /demo-analytics` or report generation after publish.

## Lazy recompute (GET/report path)

`ensureFactsComputed` without `force` recomputes when:

1. `member_week_facts` is empty for the tenant, or
2. Stored `canonicalDataVersion` differs from the current canonical watermark.

The **current canonical watermark** is a SHA-256 of `max(updated_at)` across all canonical tables plus the latest published session metadata. This is deterministic and does not rely on wall-clock time.

**Seed/mock fallback:** when no `published` ingestion session exists, only (1) applies.

## Freshness versioning

Each facts computation records two versions in `pmo.member_week_fact_versions`:

- `canonicalDataVersion`: SHA-256 of the canonical data watermark (max updated_at of canonical tables + latest published session).
- `factsVersion`: SHA-256 of `tenantId + canonicalDataVersion + factsSchemaVersion + factsRuleVersion`.

These versions are persisted on each `report_runs` row to provide audit provenance. A report can prove its facts were current at generation time.

## Rule catalog

Classification thresholds come from the versioned JSON rule catalog at `config/pmo-report-rules/default.v1.json`, resolved by `resolveReportRules({ tenantId, effectiveAt })`. The resolver:

1. Loads all `.json` files from the catalog directory.
2. Validates each via `validateRuleSet()` (Zod + band overlap/gap checks).
3. Selects the latest applicable rule by `effectiveFrom <= effectiveAt`.
4. Returns canonical JSON serialization + SHA-256 for immutable snapshots.

Legacy `pmo.overbook_idle_config` / `pmo.kpi_norms` tables are preserved. `auditLegacyRuleCompatibility()` compares and logs mismatches.

## Report engine contract

The report service (`packages/pmo/src/backend/reporting/generate-report.ts`) provides:

- `createReportRun(input)`: validates source mode, date range, rule snapshot; inserts `queued` run.
- `computeReportPayload(tenantId, reportRunId)`: ensures facts, loads bounded evidence, classifies, generates recommendations, sorts findings, persists JSON.
- `generateReport(input)`: facade that creates + computes in one call.

Both the `pmo_generateReport` agent tool and the `generate_report` ingest workflow handler call the same service. `staging_preview` source mode is rejected with a deprecation error.

## Recommendation engine

For overbook yellow/red findings, the rebalance recommendation engine (`packages/pmo/src/backend/reporting/recommendations/`) generates deterministic candidate suggestions using PMO-local skill and task-history projections. Idle findings are never source recommendations.

## Recommendation terminology

The recommendation engine uses a different decision grain from the member-week analytics grid.

### Evidence window

The evidence window is the historical period used to detect capacity issues and validate risk.

Example for the PMO_02 workbook:
- evidence window from `2026-06-29` to `2026-08-07`

Within this window, the engine may read:
- RA coverage and allocation percentages
- timesheet-derived actual utilization and effort consumption
- leave/training context
- historical skills and task history projections

### Planning horizon

The planning horizon is the future period where a rebalance action would take effect.

Default rule:
- `planningStart = nextWorkingDay(evidenceTo + 1 day)`

Example for PMO_02:
- evidence window ends on `2026-08-07`
- `2026-08-08` is a Saturday
- default planning start is `2026-08-10`

Recommendations are forward-looking actions for the planning horizon. They must not be phrased as edits to weeks that are already in the evidence window.

### Rebalance opportunity

A rebalance opportunity is the core recommendation unit.

It represents:
- one source member
- one project
- one role need
- one active RA segment
- one future planning period

The recommendation engine must generate opportunities from RA-based active-period detection, not directly from member-week findings.

### Candidate slot

A candidate slot is the future-facing capacity unit used for eligibility and ranking.

It represents:
- one target member
- their planning-period overlap with the source opportunity
- their spare RA capacity to a defined ceiling
- their validation risk from timesheet and leave/training context

Hard filters operate on candidate slots before ranking.

## Recommendation decision lock

These defaults are locked unless PMO explicitly changes them.

| Decision | Locked default |
|---|---|
| Weekend effective date | `planningStart = nextWorkingDay(evidenceTo + 1 day)` |
| Official overbook red boundary | `ra_busy_rate >= 1.20` |
| Source target busy rate | `1.00` |
| Candidate soft ceiling | `1.00` |
| Candidate hard ceiling | `1.05` |
| Partial relief | allowed only when target stays `<= 1.05` |
| `DS01.End_date` semantics | evidence coverage until future assignment end is explicitly confirmed |

Operational meaning:
- If `DS01.End_date` from the uploaded workbook only covers the evidence window, the engine must not silently collapse a valid future recommendation because that workbook boundary equals the report boundary.
- When future assignment coverage is not confirmed, the engine should surface a machine-readable `requires_ra_confirmation` state instead of returning a misleading empty result.

## Recommendation source of truth

### Official overbook detection

Recommendation opportunity creation uses an RA-based metric:

```text
ra_busy_rate = SUM(allocation_pct) across allocations active in the same segment
```

Classification for recommendation purposes:
- `< 0.75` => idle red
- `0.75 - 0.84` => underallocated watch
- `0.85 - 1.10` => normal
- `1.11 - 1.19` => overbook warning
- `>= 1.20` => overbook red

Default recommendation policy:
- only `>= 1.20` produces official overbook rebalance opportunities
- `1.11 - 1.19` remains warning-only unless PMO later enables advisory opportunities for that band

### Timesheet role

Timesheet is not the primary detector for official overbook or idle recommendation opportunities.

Timesheet is used to validate:
- source urgency
- candidate overload risk
- burnout or OT risk
- mismatch evidence

This prevents false recommendations such as assigning more work to a member who looks free on RA but is already overloaded in actual hours.

## Recommendation contract draft

Phase 0 freezes the contract shape conceptually before implementation.

```ts
interface RecommendationWindow {
  evidenceFrom: string;
  evidenceTo: string;
  planningStart: string; // nextWorkingDay(evidenceTo + 1 day)
  planningEnd: string | null;
}

interface RebalanceOpportunity {
  opportunityId: string;
  sourceMemberId: string;
  projectId: string;
  roleNeeded: string | null;
  severity: 'warning' | 'red';
  activePeriod: { from: string; to: string };
  planningPeriod: { from: string; to: string };
  currentRaBusyRate: number;
  sourceTargetBusyRate: number;
  candidateSoftCeiling: number;
  candidateHardCeiling: number;
  allowPartialRelief: boolean;
  reliefNeededPct: number;
  reliefNeededHoursPerWeek: number;
  sourceRiskFlags: string[];
}

interface CandidateSlot {
  memberId: string;
  planningOverlap: { from: string; to: string };
  currentRaBusyRate: number;
  availableCapacityPct: number;
  availableCapacityHoursPerWeek: number;
  actualUtilization: number | null;
  effortConsumption: number | null;
  overtimeRatio: number | null;
  leaveConflict: boolean;
  trainingConflict: boolean;
  candidateRiskFlags: string[];
}
```

Implementation expectations:
- render and API payloads should group by opportunity, not by affected historical week
- recommendation output should include `effectiveFrom` and `effectiveTo`
- PMO should receive up to top-3 ranked candidates per opportunity when enough valid candidates exist
- missing embeddings may reduce confidence, but must not disable deterministic recommendation when structured evidence is sufficient

## Domain events

Report lifecycle emits transactional outbox events via `withEmit()`:

- `pmo.report.requested`: on run creation
- `pmo.report.completed`: on successful completion
- `pmo.report.failed`: on terminal failure

Event payloads contain only IDs, counts, and hashes (no PII/full findings).
