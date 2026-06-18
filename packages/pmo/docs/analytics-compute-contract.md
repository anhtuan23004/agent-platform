# PMO analytics compute contract

Calculation layer contract between **ingest/publish** and **utilization analytics**.

## Data flow

```text
publishUpsert → pmo.* canonical (is_active=true)
       ↓
ensureFactsComputed(tenantId, { sessionId, force: true })
       ↓
pmo.member_week_facts (persisted read-model)
       ↓
loadFactsAndContext → findings (on-demand)
       ↓
GET /api/pmo/v1/demo-analytics
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

This avoids latency on the first `GET /demo-analytics` after publish.

## Lazy recompute (GET path)

`runDemoAnalytics` calls `ensureFactsComputed` without `force`. Facts recompute when:

1. `member_week_facts` is empty for the tenant, or
2. `computed_at` is older than the latest `published` session's `publish_reviewed_at`.

**Seed/mock fallback:** when no `published` ingestion session exists, only (1) applies.

## Optional future hook

Event `pmo.ingestion.data_published` is defined in `@seta/pmo/events` but not emitted yet.
Publish already triggers compute synchronously; a subscriber would be for cross-module reactions only.
