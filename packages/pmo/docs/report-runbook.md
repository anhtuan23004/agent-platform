# PMO report runbook

Operational guide for the PMO report pipeline (compute, render, PDF, download).

## Architecture overview

```text
User/Agent request
      |
  createReportRun (validate, snapshot rules, insert queued)
      |
  computeReportPayload (ensure facts, classify, recommend, persist JSON)
      |
  [if PDF requested] enqueue graphile-worker task pmo.report.render_pdf
      |
  renderPdfReportJob (render HTML, launch Chromium, render PDF, upload S3)
      |
  completeReportRun (persist artifact hashes, emit completed event)
      |
  GET /api/pmo/v1/reports/:id/download -> presigned S3 URL
```

## Key tables

- `pmo.report_runs`: durable state for each report run (status, rule snapshot, facts version, artifact metadata, failure details).
- `pmo.member_week_facts`: persisted read-model; report engine reads, never writes.
- `pmo.member_week_fact_versions`: freshness tracking (canonical data version, facts version).
- `pmo.member_skills_projection` / `pmo.task_history_projection`: PMO-local data for recommendations.

## Status lifecycle

```text
queued -> computing -> rendering -> completed
                  \-> failed (terminal, retryable)
```

All transitions use compare-and-set (CAS). Retry from `failed` returns to `queued`.

## Common failure scenarios

### 1. `report_pdf_limits_exceeded`
**Cause**: PDF requested with >26 weeks, >1,000 members, or >2,000 findings.
**Resolution**: Narrow the date range or member filters. JSON format has no such limit.

### 2. `report_run_not_renderable`
**Cause**: Worker picked up a run that is not in `rendering` status.
**Resolution**: Usually a stale retry. Check `report_runs.status` in DB. If stuck, manually set to `failed` and retry.

### 3. `report_html_checksum_mismatch`
**Cause**: HTML uploaded to S3 has a different SHA-256 than the in-memory render.
**Resolution**: Transient S3 issue. Graphile will retry automatically (up to 5 attempts).

### 4. `report_pdf_invalid_magic` / `report_pdf_empty`
**Cause**: Chromium produced invalid output.
**Resolution**: Check Chromium availability (`CHROMIUM_EXECUTABLE_PATH`), memory limits, and system font availability. Ensure `font-noto` packages are installed in the Docker image.

### 5. `chromium_crashed` or timeout
**Cause**: Chromium OOM or hang on large reports.
**Resolution**: Reduce report scope. Check ECS task memory. The PDF worker runs with network disabled; no external resource should be fetched.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PMO_REPORT_S3_BUCKET` | No | Falls back to `S3_BUCKET` | Private bucket for report artifacts |
| `CHROMIUM_EXECUTABLE_PATH` | Yes (for PDF) | `/usr/bin/chromium-browser` | System Chromium binary |
| `PMO_REPORT_MAX_ARTIFACT_BYTES` | No | `26214400` (25 MiB) | Max HTML/PDF artifact size |
| `PMO_REPORT_RULES_DIR` | No | `config/pmo-report-rules/` | Directory for versioned rule JSON files |

## Monitoring

### Structured logs

The reporting pipeline logs key events via pino (`pmo/reporting` and `pmo/report-pdf`):

- `creating report run` — on `createReportRun`, with tenant, source mode, date range, report types.
- `report payload computed` — on `computeReportPayload`, with member/finding counts and duration.
- `render-pdf job started/completed/failed` — on worker entry/exit, with duration and artifact sizes.
- `render-pdf HTML/PDF rendered` — size and page count after each render step.

### Domain events

Subscribe to `pmo.report.requested`, `pmo.report.completed`, `pmo.report.failed` in `core.events` for alerting on failure rates.

### Database queries

```sql
-- Report failure rate (last 24h)
SELECT status, count(*) FROM pmo.report_runs
WHERE created_at > now() - interval '24 hours'
GROUP BY status;

-- Stuck runs (queued/computing/rendering > 10 min)
SELECT id, status, created_at, updated_at FROM pmo.report_runs
WHERE status IN ('queued', 'computing', 'rendering')
  AND updated_at < now() - interval '10 minutes';
```

## Manual recovery

### Retry a failed run

```http
POST /api/pmo/v1/reports/:id/retry
```

Or via DB:

```sql
UPDATE pmo.report_runs SET status = 'queued', updated_at = now()
WHERE id = '<run-id>' AND status = 'failed';
```

Then re-enqueue the graphile job (or wait for the 2s poll fallback).

### Force recompute facts

```http
POST /api/pmo/v1/analytics/compute-facts
Content-Type: application/json
{ "ingestion_session_id": "<uuid>" }
```

Or programmatically: `ensureFactsComputed(tenantId, { force: true })`.
