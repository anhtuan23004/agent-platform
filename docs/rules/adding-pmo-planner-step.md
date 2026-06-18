# Adding A PMO Planner Step

Use this checklist when adding a new step to the PMO ingest planner workflow. The
goal is to make the planner classify the step, let the backend runtime execute
it, and let the frontend render and resume it when user input is required.

## 1. Define The Planner Contract

Update the planner catalog files:

- `config/ingestion-planner/pmo/steps.json`
  - Add the new `action_id`.
  - Set `step_name`, `review_type`, `objective`, `agent_responsibility`,
    `user_responsibility`, `default_requires_user_review`,
    `allowed_intent_modes`, `requires_prior_checkpoint`, and `produces`.
- `config/ingestion-planner/pmo/intents.json`
  - Add the new `action_id` to each intent mode that may use the step.
  - Add a new intent mode only when the requested outcome is meaningfully new.
- `config/ingestion-planner/pmo/classification-rules.json`
  - Add rules that tell the planner when to choose the intent or step.
- `config/ingestion-planner/pmo/examples.json`
  - Add examples for goals that should select the new step.

Keep catalog metadata consistent. If an intent can run the step chain, the
`allowed_intent_modes` for each participating step should include that intent,
even if the compiler currently relies on `intents.json` as the active allowlist.

## 2. Extend Backend Planner Types

Update the backend planner schema and metadata:

- `packages/pmo/src/backend/planning/catalog.ts`
  - Add the action id to `ActionIdSchema`.
  - Add a review type to `ReviewTypeSchema` when the step needs a new review
    category.
  - Add a new intent mode to `PMO_INTENT_MODES` and `IntentModeSchema` when
    needed.
- `packages/pmo/src/backend/planning/step-metadata.ts`
  - Add the action id to `PMO_PLAN_ACTION_IDS`.
  - Add the review type to `PMO_REVIEW_TYPES` when needed.
  - Update `derivePmoActionId()` if planner step text should map to the action.
  - Update `reviewTypeForPmoAction()`.
- `packages/pmo/src/backend/planning/compiler.ts`
  - Add the action id to `isStringActionId()`.
- `packages/pmo/src/backend/planning/plan-schema.ts`
  - Add any new intent mode to the plan schema.

## 3. Add Runtime State And Output

If the step needs durable workflow state, update:

- `packages/pmo/src/backend/workflows/ingest-data-v2/types.ts`
  - Add session statuses such as `awaiting_my_step`, `running_my_step`, or
    `my_step_completed`.
  - Add fields to `DynamicIngestRuntimeContext` for request/result state.
- `packages/pmo/src/backend/workflows/ingest-data-v2/schemas.ts`
  - Add resume payload fields when the frontend sends structured input.
  - Add workflow output fields when the completed workflow returns data.
- `packages/pmo/src/backend/profiling/workbook-profiling.ts`
  - Persist new workflow execution state fields when they must survive reloads.

## 4. Implement The Backend Handler

Create a handler under:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/handlers/
```

Use the `PmoDynamicStepHandler` shape:

```ts
export function createMyStepHandler(deps: MyStepDeps): PmoDynamicStepHandler {
  return {
    actionId: 'my_step',
    execute: async (input) => {
      // Validate prior checkpoint or runtime prerequisites.
      // Read and patch input.runtimeContext.
      // Suspend with an approval card if user input is required.
      // Complete with outputSummary and optional terminalOutput when done.
    },
  };
}
```

Handler return patterns:

- `kind: 'suspend'`
  - Use when the step needs user input.
  - Include `card`, `sessionStatus`, `runtimeContextPatch`, and optional
    `outputSummary`.
- `kind: 'completed'`
  - Use when the step finishes.
  - Include `sessionStatus`, `runtimeContextPatch`, `outputSummary`, and
    `terminalOutput` when final workflow output should include the result.
- `kind: 'rejected'`
  - Use when rejecting this step should reject or stop the workflow.

For reference, `generate_report` is implemented in
`packages/pmo/src/backend/workflows/ingest-data-v2/handlers/generate-report.ts`.

## 5. Register The Handler In The Orchestrator

Update `packages/pmo/src/backend/workflows/ingest-data-v2/orchestrator.ts`:

- Import the handler.
- Add it to `buildStepRegistry()`.
- Update `statusForAction()` with the runtime status for the new action.
- If the step contributes terminal workflow output, carry it through the final
  output assembly.

The orchestrator should continue to the next planner step unless there is no
next step or the handler explicitly suspends/rejects.

## 6. Add HITL Cards When Needed

If the step needs user approval or editable input, add a card builder in:

```text
packages/pmo/src/backend/workflows/ingest-data-v2/cards.ts
```

Use this structure:

```ts
export function buildMyStepCard(input: MyStepCardInput): ApprovalCard {
  return {
    toolCallId: `workflow:${input.runId}:pmo_myStep`,
    intent: 'Confirm my step',
    riskBadge: 'write',
    summary: 'Explain what the user is approving.',
    details: [],
    primary: {
      label: 'Approve',
      argsPatch: { decision: 'approve' },
    },
    alternates: [],
    decline: {
      label: 'Reject',
      argsPatch: { decision: 'reject' },
    },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_myStep',
      ...plannerStepMeta(input.plannerStep),
      ts: new Date().toISOString(),
    },
  };
}
```

Use `argsPatch` for the resume payload the handler expects.

## 7. Add Persistence Or Agent Tools If Needed

If the step writes new PMO data:

- Update `packages/pmo/src/backend/db/schema.ts`.
- Generate migrations with the module CLI:

```bash
pnpm --filter @seta/pmo db:generate
pnpm db:migrate
```

Do not hand-edit generated Drizzle migrations.

If the step exposes an agent tool:

- Add the tool under `packages/pmo/src/backend/agent-tools/`.
- Export it from `packages/pmo/src/backend/agent-tools/index.ts`.
- Keep RBAC and tool descriptions precise.

## 8. Update Frontend Types And Logic

Update frontend API and planner helpers:

- `apps/web/src/modules/pmo/api/client.ts`
  - Add the action id, review type, statuses, and output/context fields.
- `apps/web/src/modules/pmo/pages/pmo-page.logic.ts`
  - Add the action id and review type to local unions.
  - Update step inference helpers when the frontend derives a step from text.

## 9. Render The Step In The Frontend

Update the workflow execution UI:

- `apps/web/src/modules/pmo/components/pmo-execution-step-card.tsx`
  - Add a detector such as:

    ```ts
    const isLikelyMyStep =
      step.action_id === 'my_step' ||
      step.review_type === 'my_review' ||
      /my keyword/i.test(step.step_name);
    ```

  - Add a dedicated panel for the step.
  - Render pending approval input, read-only historical state, and completed
    output.
- Add a hook like `use-pmo-my-step-actions.ts` when the panel submits resume
  decisions.
  - Use `useSubmitWorkflowRuntimeDecision()`.
  - Send `approvalId`, `decision`, and `payloadPatch`.
- Wire the hook through `apps/web/src/modules/pmo/pages/pmo-page.tsx`.
- If approvals need selection/filtering, update
  `apps/web/src/modules/pmo/hooks/use-pmo-workflow-runtime.ts`.

For reference, report range confirmation uses:

- `apps/web/src/modules/pmo/hooks/use-pmo-report-range-actions.ts`
- `apps/web/src/modules/pmo/components/pmo-execution-step-card.tsx`

## 10. Add Tests

Add focused tests for each layer touched:

- Planner/compiler
  - The intended goal compiles to the new action id in the correct order.
  - Goals that should not include the step do not include it.
- Handler
  - Missing prerequisites fail or suspend as expected.
  - Valid input completes.
  - Approve, modify, and reject resume payloads behave correctly.
- Card
  - `toolId`, `plannerStep` metadata, labels, and `argsPatch` are correct.
- Analytics or persistence
  - Range filters, tenant scoping, and persisted output are correct.
- Frontend
  - The step panel renders pending, completed, and rejected states.
  - Resume actions send the expected payload.

Useful targeted commands:

```bash
pnpm exec vitest run packages/pmo/tests/unit/planning/compiler.test.ts
pnpm exec vitest run packages/pmo/tests/unit/workflows/ingest-data-v2/<my-step>.test.ts
```

Before claiming the work is done, run the repo checks required by `AGENTS.md`:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Run `pnpm test:e2e` when the UI changed.

## End-To-End Checklist

- Planner catalog includes the action and examples.
- Backend planner schemas accept the action, review type, and intent mode.
- Compiler can emit the step in the intended order.
- Runtime state can persist the step request/result.
- Handler is implemented and registered.
- HITL card exists if user input is required.
- DB migration or agent tool is added when needed.
- Frontend client types know the action/review/status/output.
- Workflow UI renders the step.
- Resume hook submits the expected payload.
- Unit tests cover planner, handler, and card behavior.
- UI tests cover any new interactive panel.
