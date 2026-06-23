---
name: goal
description: >-
  Implements the full PMO Agent generic orchestration roadmap (Phases 1–4):
  listMemberUtilization, queryUtilization(intent), answerQuestion, working memory,
  and staffing-style thin orchestrator. Use when the user invokes /goal or asks to
  make PMO chat generic like the Staffing Agent.
disable-model-invocation: true
---

# /goal — PMO Agent generic orchestration (all phases)

Implement **all four phases** end-to-end in `agent-platform`. Mirror the **Staffing orchestrator pattern** (thin router LLM + intent enum + deterministic sub-agents + composite tools). Do **not** rely on slang→domain maps (e.g. "chilling"→idle); use **explicit tool params** and `needsClarification` when thresholds are missing.

## Non-negotiables (repo)

- Read `CLAUDE.md`, `docs/architecture.md`, `packages/staffing/src/backend/orchestration/` as the reference shape.
- PMO chat stays **analytics-only** on published data; ingest/publish remains `/pmo`.
- Cross-module imports via `packages/pmo/src/index.ts` public surface only.
- Tests: real Postgres via testcontainers; write failing test first.
- Verify: `pnpm typecheck && pnpm lint && pnpm test` (PMO + web unit tests for changed UI/tools).
- No hand-edited `package.json` versions; `pnpm add` only.

## Staffing pattern to copy

| Staffing | PMO equivalent |
|----------|----------------|
| `orchestrator.ts` + `orchestrator.tools.ts` | `pmo-chat-orchestration.ts` → split into orchestrator + tools |
| `staffing_analyzeTasks(intent)` | `pmo_queryUtilization(intent)` |
| `taskAnalyzer` sub-agent (deterministic + small LLM extract) | `utilization-query` sub-agent |
| `staffing_proposeAssignment` composite | `pmo_proposeReport` / reuse `pmo_recommendRebalance` |
| `staffing_answerQuestion` | `pmo_answerQuestion` |
| `recordEntityExposure` | Extend for PMO member/date/session (Phase 3) |
| `instructionsText()` recipe prompts | Thin orchestrator instructions; formulas in `pmo_explainFormula` |

Reference: [reference.md](reference.md)

---

## Phase checklist

Copy and track:

```
- [ ] Phase 1 — pmo_listMemberUtilization + scope defaults
- [ ] Phase 2 — pmo_queryUtilization(intent) facade
- [ ] Phase 3 — pmo_answerQuestion + PMO working memory
- [ ] Phase 4 — Orchestrator refactor + wire server + tests
- [ ] Verify full suite
```

---

## Phase 1 — `pmo_listMemberUtilization`

**Goal:** Answer arbitrary busy-rate questions (`> 50%`, counts) without slang mapping.

### Add tool

`packages/pmo/src/backend/agent-tools/list-member-utilization.ts`

- **Input:** `dateRange?`, `ingestionSessionId?`, `memberId?`, `busyRateGt?`, `busyRateLt?`, `issueTypes?` (`overbook`|`idle`|`ok`|`all`)
- **Output:** `{ members: [{ memberId, busyRate, effortConsumption, issueType, ragColor }], summary: { total, matched } }`
- **Logic:** `loadFactsAndContext` → `aggregateMemberFacts` → filter in TypeScript (deterministic).
- **Defaults:** If `dateRange` omitted, resolve from chat scope (`reportingDateFrom/To` in `PmoChatRunCtx`) or canonical reporting window for session/tenant — **in tool code**, not LLM.
- **Clarification:** If user intent needs a threshold but none provided and no SOP default requested, return `{ needsClarification: true, options: [...] }` instead of guessing.

### Register

- Export from `agent-tools/index.ts` and `packages/pmo/src/agent-tools` public path if applicable.
- Unit tests: `packages/pmo/tests/unit/agent-tools/list-member-utilization.test.ts`
- Reuse patterns from `detect-overbook-idle.test.ts` / `detect-scope.test.ts`

### Do not

- Map colloquial terms to thresholds in code or prompts.

---

## Phase 2 — `pmo_queryUtilization(intent)`

**Goal:** Single entry tool like `staffing_analyzeTasks`; orchestrator picks intent, sub-path is deterministic.

### Add tool

`packages/pmo/src/backend/orchestration/pmo-orchestrator.tools.ts` (or `agent-tools/query-utilization.ts`)

**Intent enum:**

```ts
'count_members_by_busy_rate'  // requires busyRateGt and/or busyRateLt
'list_flagged_members'        // overbook | idle | mismatch via existing detectors
'member_detail'               // one member: busy, EC, excludedWeeks, week breakdown
'report_summary'              // delegates to generateReport (dateRange required or defaulted)
'rebalance_candidates'        // delegates to recommendRebalance
'explain_methodology'         // delegates to explainFormula
```

Each intent **delegates** to existing implementations; no duplicate analytics logic.

### Sub-agent (optional but preferred)

`packages/pmo/src/backend/orchestration/agents/utilization-query.ts`

- `SpecializedAgentSpec` like staffing `task-analyzer.ts`
- Deterministic execute per intent; LLM only if you add structured extraction for numeric thresholds from user text (return `0.5` for "50%", not "chilling"→idle)

### Tests

- `packages/pmo/tests/unit/orchestration/pmo-orchestrator.tools.test.ts` — intent wiring without LLM (test seams)

---

## Phase 3 — `pmo_answerQuestion` + working memory

**Goal:** General/out-of-domain questions without wrong tool calls; follow-ups ("Why?", "latest month") use thread state.

### General answer agent

`packages/pmo/src/backend/orchestration/agents/general-answer.ts`

- Mirror `packages/staffing/src/backend/orchestration/agents/general-answer.ts`
- Redirect: roles/org chart → Staffing Agent; ingest/publish → `/pmo`

### Tool

`pmo_answerQuestion` — passes full `userText` (with scope block), read-only memory.

### Extend entity recorder

`sdks/agent/src/working-memory-schema.ts` + `entity-recorder.ts`:

```ts
recentMembers?: Array<{ memberId: string; label: string }>
lastDiscussedMemberId?: string | null
lastDateRange?: { from: string; to: string } | null
lastIngestionSessionId?: string | null
```

Record after `listMemberUtilization`, `queryUtilization`, `generateReport` results via `recordEntityExposure`.

### Orchestrator instructions

- Missing threshold → tool returns clarification; orchestrator presents options A/B/C to user.
- Default date from `<<<PMO_ANALYTICS_SCOPE>>>` — do not re-ask when scope has reporting period.

### Tests

- `sdks/agent/tests/unit/entity-recorder.test.ts` — PMO patch fields
- Web: optional chat composer unchanged; memory is server-side

---

## Phase 4 — Thin orchestrator refactor

**Goal:** Replace monolithic `pmo-chat-orchestration.ts` INSTRUCTIONS + flat tools with staffing-shaped orchestrator.

### Files

| Action | Path |
|--------|------|
| Create | `packages/pmo/src/backend/orchestration/orchestrator.ts` |
| Create | `packages/pmo/src/backend/orchestration/orchestrator.tools.ts` |
| Create | `packages/pmo/src/backend/orchestration/schemas.ts` |
| Create | `packages/pmo/src/backend/orchestration/trust.ts` (or reuse agent-sdk pattern) |
| Refactor | `packages/pmo/src/backend/chat/pmo-chat-orchestration.ts` — delegate to orchestrator `runStream` |
| Export | `packages/pmo/src/chat.ts` or index subpath — keep `buildPmoChatOrchestrationRuntime` API stable for `apps/server` |
| Wire | `apps/server/src/index.ts` — no API change if runtime signature unchanged |

### Orchestrator tools surface (final)

- `pmo_queryUtilization`
- `pmo_listMemberUtilization` (may be internal to query intent; expose one or both)
- `pmo_answerQuestion`
- `pmo_explainFormula` (keep or fold into query intent `explain_methodology`)
- Composite: `pmo_proposeReport` (facts + generateReport) — optional if `report_summary` intent suffices
- Keep `pmo_computeMemberWeekFacts` callable from composite/report paths only; remove from top-level orchestrator prompt as primary step

### Instructions style

Copy structure from `staffing orchestrator instructionsText()`:

- WHEN to use each intent
- WHEN to STOP
- WHEN to call `pmo_answerQuestion`
- NEVER invent numbers
- Pass `ingestionSessionId` from scope when present

### Trust envelope

Map tool calls to `reasoningTrace` like staffing `trustFromMastraResult`.

### Tests

- `packages/pmo/tests/unit/chat/pmo-chat-orchestration.test.ts` — update for new wiring
- Integration: chat tool registration still lists PMO tools
- Contract test: "busy rate > 50%" with seeded data returns count without asking date when scope has range

---

## Execution order

1. Phase 1 (standalone value, unblocks generic queries)
2. Phase 2 (facade; can ship with Phase 1 tool as backend)
3. Phase 3 (memory + general answer)
4. Phase 4 (refactor entrypoint; Phases 1–3 code moves under `orchestration/`)

Do not start Phase 4 until Phase 1 tests pass.

---

## Definition of done

- [ ] User can ask "how many members busy rate > 50%" with scoped session **without** spurious date-range prompts
- [ ] Ambiguous "chilling" returns clarification options, not invented idle list
- [ ] "Why?" after a member answer uses `member_detail` intent + prior `lastDiscussedMemberId`
- [ ] Roles question routes to `pmo_answerQuestion` / Staffing redirect, not detect tools
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green
- [ ] `pnpm depcruise` — no new boundary violations

## Additional resources

- File map and schemas: [reference.md](reference.md)
