# @seta/pmo

The PMO module owns workbook ingestion, canonical PMO data, tenant-scoped analytics, and idle or
overbook report generation.

## Intent-to-plan flow

The PMO planner classifies the goal before generating a plan. Its structured intent result is the
only input used to select allowed planner actions.

- A goal with no workbook may use `generate_report_intent`; its plan contains only
  `generate_report` and reads existing canonical data.
- An uploaded workbook with an ingest-and-report goal uses `publish_report_intent`; report
  generation runs after the approved ingest path.
- The LLM extracts explicit report dates and report types. TypeScript validates date order,
  tenant-scoped database bounds, workflow prerequisites, and execution permissions.
- When dates are missing, planning stops at the intent card before plan generation. Database-only
  reports require a manual range within the minimum and maximum active canonical dates.
  Ingest-and-report intents let the user choose sheet-derived dates or a manual database range.
  The confirmed structured intent is persisted, then passed unchanged into plan generation.

## Public surface

- `@seta/pmo` — application services (Node)
- `@seta/pmo/events` — event type constants + zod payload schemas
- `@seta/pmo/rbac` — permission constants
- `@seta/pmo/contracts` — browser-safe DTOs + zod schemas
- `@seta/pmo/register` — `ContributionRegistry` hook (Node)

## Events emitted

_(none yet)_

## Events consumed

_(none yet)_

## RBAC

Module permissions are declared as a typed `statement` in `src/rbac.ts` and built into a `ModuleRbacManifest` via `toManifest(...)` from `@seta/shared-rbac`.

**Important:** the statement in `src/rbac.ts` is not the source of truth on its own — it must be mirrored into `packages/shared-rbac/src/inventory.ts` (the `INVENTORY` array). The runtime resolver, the `gen:rbac` codegen, and `@seta/identity` all build the permission registry from `INVENTORY` via `inventoryToManifests(INVENTORY)`. Until this module's permissions appear in `INVENTORY`, the aggregate parity test (`apps/server/tests/unit/rbac-registry-parity.test.ts`) will flag the module — that guardrail is intentional.

After updating both files (keep resources, actions, role permissions, and role descriptions identical):

1. Run `pnpm gen:rbac` to regenerate the `PermissionKey` union in `packages/shared-rbac/src/generated/`.
2. Add a per-module parity test — copy `packages/knowledge/tests/unit/rbac-parity.test.ts` as a starting point.

See `packages/knowledge/src/rbac.ts` for a complete example.
