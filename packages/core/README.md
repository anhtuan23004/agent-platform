# @seta/core

Transactional outbox, domain-event bus, dispatcher, and graphile-worker
jobs — the shared spine of the Seta modular monolith. Every module emits
events through `core.emit()` in the same transaction as its state
change; subscribers wake via `LISTEN/NOTIFY` with a 2 s fallback poll.

## Exports

| Entry | Purpose |
|---|---|
| `@seta/core` | Public surface — registry, lifecycle, RPC composition |
| `@seta/core/events` | Event-type catalog and emit helpers |
| `@seta/core/dispatcher` | Subscriber dispatch loop with at-least-once delivery |
| `@seta/core/workers` | graphile-worker task registration |
| `@seta/core/backend` | Hono router primitives and RBAC middleware |
| `@seta/core/db` | Pooled Drizzle client (`core` schema) |
| `@seta/core/db/schema` | `core.events`, `core.audit`, dispatcher tables |
| `@seta/core/outbox` | Outbox row writer (used by `emit`) |
| `@seta/core/rpc` | Cross-module RPC surface |
| `@seta/core/register` | Module registration hook |
