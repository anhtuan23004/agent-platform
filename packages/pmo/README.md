# @seta/pmo

The PMO module owns workbook ingestion, canonical PMO data, tenant-scoped analytics, and idle or
overbook report generation.

## Intent-to-plan flow

The PMO planner classifies three intent axes before generating a plan:
`dataSourceMode`, `actionMode`, and validator-derived `writePolicy`. The compiler converts these
axes into a deterministic catalog step chain.

- `inspect_file`, `review_staging`, `validate`, and `preview_changes` are read-only outcomes with
  progressively deeper workbook processing.
- `publish` and `publish_then_report` require explicit approval before canonical DB writes.
- `existing_db + generate_report` reads canonical data without workbook steps.
- `uploaded_file + generate_report` suspends for a supported Phase 1 alternative; staging-preview
  reports arrive in Phase 2.
- The LLM extracts explicit report dates and report types. TypeScript validates date order,
  tenant-scoped database bounds, workflow prerequisites, and execution permissions.
- Report dates resolve inside `generate_report`, after prior workflow steps provide maximum
  context. Missing dates suspend with the existing report-range card.

## Public surface

- `@seta/pmo` — application services (Node)
- `@seta/pmo/events` — event type constants + zod payload schemas
- `@seta/pmo/rbac` — permission constants
- `@seta/pmo/contracts` — browser-safe DTOs + zod schemas
- `@seta/pmo/register` — `ContributionRegistry` hook (Node)

## Report delivery

- `POST /api/pmo/v1/reports` creates a tenant-scoped canonical-data report and enqueues JSON or PDF
  work. Caller supplies an explicit date range inside canonical bounds; tenant comes only from the
  authenticated session.
- `GET /api/pmo/v1/reports/:id` returns durable status, summary counts, failure detail, and artifact
  availability. It never returns PDF bytes.
- `GET /api/pmo/v1/reports/:id/download?format=pdf|html` redirects to a private S3 GET signed for
  five minutes with a safe attachment filename.
- `POST /api/pmo/v1/reports/:id/retry` requeues failed runs. Graphile job keys and S3 keys are stable
  per report run, so retry is idempotent.
- All report endpoints require `pmo.data.read` and scope every DB lookup to session tenant.

## Events emitted

- `pmo.report.requested`
- `pmo.report.completed`
- `pmo.report.failed`

## Events consumed

_(none yet)_

## RBAC

Module permissions are declared as a typed `statement` in `src/rbac.ts` and built into a `ModuleRbacManifest` via `toManifest(...)` from `@seta/shared-rbac`.

**Important:** the statement in `src/rbac.ts` is not the source of truth on its own — it must be mirrored into `packages/shared-rbac/src/inventory.ts` (the `INVENTORY` array). The runtime resolver, the `gen:rbac` codegen, and `@seta/identity` all build the permission registry from `INVENTORY` via `inventoryToManifests(INVENTORY)`. Until this module's permissions appear in `INVENTORY`, the aggregate parity test (`apps/server/tests/unit/rbac-registry-parity.test.ts`) will flag the module — that guardrail is intentional.

After updating both files (keep resources, actions, role permissions, and role descriptions identical):

1. Run `pnpm gen:rbac` to regenerate the `PermissionKey` union in `packages/shared-rbac/src/generated/`.
2. Add a per-module parity test — copy `packages/knowledge/tests/unit/rbac-parity.test.ts` as a starting point.

See `packages/knowledge/src/rbac.ts` for a complete example.
