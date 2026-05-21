# @seta/planner

Planner domain module — plans, buckets, groups, and tasks with kanban,
grid, and sheet projections. Two-way sync with Microsoft Planner via
the integrations module. Read models are local; cross-module
references (e.g. `assignee_id`) are bare `bigint` columns with no
foreign keys, kept consistent via event subscribers.

## Exports

| Entry | Purpose |
|---|---|
| `@seta/planner` | Public surface — plan/bucket/group/task commands and queries |
| `@seta/planner/events` | `planner.task.*`, `planner.bucket.*`, … events |
| `@seta/planner/register` | Module registration hook |
