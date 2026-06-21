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

## Domain events

Report lifecycle emits transactional outbox events via `withEmit()`:

- `pmo.report.requested`: on run creation
- `pmo.report.completed`: on successful completion
- `pmo.report.failed`: on terminal failure

Event payloads contain only IDs, counts, and hashes (no PII/full findings).
