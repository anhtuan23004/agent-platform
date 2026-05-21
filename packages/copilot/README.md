# @seta/copilot

AI copilot module — Mastra agents, AI SDK v6 tool wrappers, and the
human-in-the-loop (HITL) approval flow. Every write tool sets
`needsApproval: true`; the web client renders an assistant-ui
Interactable confirmation card before execution. Read tools run
directly.

One domain per agent, ≤ ~15 tools each — overflowing the schema budget
burns prompt-cache hits and degrades tool selection.

## Exports

| Entry | Purpose |
|---|---|
| `@seta/copilot` | Public surface — chat handler, agent factory |
| `@seta/copilot/events` | `copilot.message.*`, `copilot.tool.*` events |
| `@seta/copilot/testing` | Test fixtures for chat sessions and tool calls |
| `@seta/copilot/register` | Module registration hook |
