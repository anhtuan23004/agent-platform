# /goal — implementation reference

## Canonical paths (current)

| Area | Path |
|------|------|
| PMO chat runtime | `packages/pmo/src/backend/chat/pmo-chat-orchestration.ts` |
| PMO analytics tools | `packages/pmo/src/backend/agent-tools/` |
| Facts + aggregation | `packages/pmo/src/backend/analytics/findings.ts` (`aggregateMemberFacts`, `detectOverbookIdle`) |
| Load facts | `packages/pmo/src/backend/analytics/findings-context.ts` |
| Default thresholds | `packages/pmo/src/backend/analytics/types.ts` (`DEFAULT_THRESHOLDS`) |
| Chat scope block | `buildAnalyticsScopeBlock()` in pmo-chat-orchestration |
| Server wire | `apps/server/src/index.ts` → `buildPmoChatOrchestrationRuntime` |
| Staffing orchestrator | `packages/staffing/src/backend/orchestration/orchestrator.ts` |
| Staffing tools | `packages/staffing/src/backend/orchestration/orchestrator.tools.ts` |
| Entity recorder | `sdks/agent/src/entity-recorder.ts` |
| Working memory schema | `sdks/agent/src/working-memory-schema.ts` |

## Staffing orchestrator deps pattern

```ts
// packages/staffing/src/backend/orchestration/orchestrator.ts
makeOrchestratorTools({
  taskAnalyzer, skillMatcher, avaiChecker, recommender,
  generalAnswer, userProfileLookup, assign,
  userText, ctx,
});
```

PMO orchestrator deps analogue:

```ts
makePmoOrchestratorTools({
  utilizationQuery,      // SpecializedAgentSpec
  generalAnswer,
  listMemberUtilization, // direct port or inside utilizationQuery
  generateReport,        // existing generatePmoReport path
  recommendRebalance,
  explainFormula,
  userText,
  ctx,
});
```

## `pmo_listMemberUtilization` output schema (suggested)

```ts
const memberRowSchema = z.object({
  memberId: z.string(),
  busyRate: z.number().nullable(),
  effortConsumption: z.number().nullable(),
  issueType: z.enum(['overbook', 'idle', 'mismatch_under', 'mismatch_over', 'ok']),
  ragColor: z.enum(['green', 'yellow', 'red', 'none']),
});

const outputSchema = z.object({
  members: z.array(memberRowSchema),
  summary: z.object({
    totalMembers: z.number().int(),
    matchedMembers: z.number().int(),
  }),
  dateRange: z.object({ from: z.string(), to: z.string() }).optional(),
  needsClarification: z.boolean().optional(),
  clarificationOptions: z.array(z.string()).optional(),
});
```

Classification per member: reuse `classifyPrimaryBusyRate` from `findings.ts`.

## `pmo_queryUtilization` intent routing

| intent | Delegates to |
|--------|----------------|
| `count_members_by_busy_rate` | `listMemberUtilization` + count |
| `list_flagged_members` | `detectOverbookIdle` + `detectMismatch` (merge) |
| `member_detail` | `listMemberUtilization({ memberId })` + week facts if needed |
| `report_summary` | `generatePmoReport` / `pmo_generateReport` tool |
| `rebalance_candidates` | `pmo_recommendRebalance` |
| `explain_methodology` | `pmo_explainFormula` |

## Date range resolution (tool-side)

Priority order:

1. Explicit `input.dateRange` from orchestrator
2. `PmoChatRunCtx.reportingDateFrom/To` injected via scope block
3. Selected session `reporting_period_start/end` from `verifyPublishedSession` + session row
4. Full span of loaded canonical weeks for tenant/session

Never require the LLM to invent dates.

## Clarification pattern (no slang map)

When query is under-specified (e.g. "chilling", "not busy" without %):

```ts
return {
  needsClarification: true,
  clarificationOptions: [
    'PMO idle red: busyRate < 75%',
    'PMO idle yellow: busyRate < 85%',
    'Custom threshold (user specifies %)',
    'No planned hours in period',
  ],
};
```

Orchestrator presents options; next turn passes explicit `busyRateLt`.

## Phase 4 export stability

`apps/server` imports:

```ts
import { buildPmoChatOrchestrationRuntime } from '@seta/pmo/chat';
```

Keep this function signature. Internal implementation may delegate to `makePmoOrchestratorAgent(deps).runStream`.

Check `packages/pmo/package.json` exports for `/chat` subpath.

## Tests to add/update

| Phase | Test file |
|-------|-----------|
| 1 | `packages/pmo/tests/unit/agent-tools/list-member-utilization.test.ts` |
| 2 | `packages/pmo/tests/unit/orchestration/pmo-orchestrator.tools.test.ts` |
| 3 | `sdks/agent/tests/unit/entity-recorder.test.ts` (PMO fields) |
| 3 | `packages/pmo/tests/unit/orchestration/general-answer.test.ts` |
| 4 | `packages/pmo/tests/unit/chat/pmo-chat-orchestration.test.ts` |
| 4 | `packages/pmo/tests/integration/agent-tools/register.test.ts` (tool ids) |

## Anti-patterns

- Do not add `chilling` → `idleThreshold` mapping in classifier or prompts.
- Do not expose ingest/publish tools in PMO chat orchestrator.
- Do not return counts without calling a tool that computed them.
- Do not break `<<<PMO_ANALYTICS_SCOPE>>>` session scoping from `use-pmo-chat-ingest-attachments.ts`.
