import { toAISdkStream } from '@mastra/ai-sdk';
import type { ApprovalCard } from '@seta/agent-sdk';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { Hono } from 'hono';
import { z } from 'zod';
import { recordApprovalDecision } from '../domain/decide-approval.ts';
import {
  PendingAssignmentExistsError,
  PMO_ORCHESTRATOR_WORKFLOW_ID,
  STAFFING_ORCHESTRATOR_WORKFLOW_ID,
  writeChatApprovalRow,
} from '../domain/write-chat-approval-row.ts';
import { type ApprovalEvent, pumpOrchestrationStream } from '../orchestration-ui-stream.ts';
import {
  type AgentRouteDeps,
  type AgentRouteEnv,
  type ChatAgent,
  handleDomainError,
  NO_BUFFER_HEADERS,
} from './_shared.ts';

const ResumeBody = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approve', 'reject', 'modify', 'clarify']),
  overrideUserIds: z.array(z.string()).optional(),
  alternateIndices: z.array(z.number().int().min(0)).optional(),
  payloadPatch: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  clarificationMessage: z.string().optional(),
});

export type ResumeDecisionData = {
  decision: 'approve' | 'reject' | 'modify' | 'clarify';
  overrideUserIds?: string[];
  alternateIndices?: number[];
  payloadPatch?: Record<string, unknown>;
  note?: string;
  clarificationMessage?: string;
  previousClarifications?: Array<{ role: string; message: string; ts: string }>;
};

/**
 * Maps a decide-approval decision + the persisted ApprovalCard + the request
 * body into the workflow's resume payload. Merges the full `argsPatch` from
 * the chosen card option (primary, alternate, or decline) so domain-specific
 * fields are forwarded to the handler — not only staffing's
 * `assigneeUserIds` but also PMO's `approvedItemKey`, `approvedItemKeys`,
 * `mappingOverrides`, `proceedToNextStep`, report-range date params, etc.
 *
 * The body's `decision` always takes precedence over any `decision` field
 * inside `argsPatch`. Client-supplied `payloadPatch` overrides card values
 * (applied last by `withNote`).
 *
 * Card contract (staffing):
 *   primary.argsPatch     = { action:'assign', assigneeUserIds: string[], taskId }
 *   alternates[i].argsPatch = { action:'assign', assigneeUserIds: string[], taskId }
 *
 * Card contract (PMO mapping):
 *   primary.argsPatch     = { decision, approvedItemKey?, approvedItemKeys,
 *                             approvedByByItemKey, mappingOverrides, proceedToNextStep? }
 *   alternates[i].argsPatch = { decision, approvedItemKeys, approvedByByItemKey,
 *                               mappingOverride, mappingOverrides }
 *   decline.argsPatch     = { decision, approvedItemKeys, approvedByByItemKey, mappingOverrides }
 */
export function mapDecisionToResumeData(
  card: ApprovalCard | null,
  body: ResumeDecisionData,
): ResumeDecisionData {
  const note = body.note;
  const payloadPatch = body.payloadPatch ?? {};
  const withNote = (d: ResumeDecisionData): ResumeDecisionData =>
    note !== undefined ? { ...d, ...payloadPatch, note } : { ...d, ...payloadPatch };

  if (body.decision === 'clarify') {
    const clarificationMessage = body.clarificationMessage ?? body.note ?? '';
    // Forward existing clarifications from the card so the agent sees the full history.
    const previousClarifications = (() => {
      if (!card) return [];
      const c = card as unknown as { clarifications?: unknown };
      return Array.isArray(c.clarifications) ? c.clarifications : [];
    })();
    return {
      decision: 'clarify' as const,
      clarificationMessage,
      previousClarifications,
      note: body.note,
    };
  }

  if (body.decision === 'reject') {
    // Merge decline.argsPatch so accumulated state (e.g. PMO approvedItemKeys,
    // mappingOverrides) is forwarded to the handler.
    const declinePatch = (card?.decline?.argsPatch ?? {}) as Record<string, unknown>;
    return withNote({ ...declinePatch, decision: 'reject' } as ResumeDecisionData);
  }

  if (body.decision === 'modify') {
    // For modify with alternates (e.g. PMO mapping "use different column"),
    // merge the alternate's argsPatch so domain-specific fields like
    // mappingOverride, mappingOverrides, approvedItemKeys are forwarded.
    const modIdx = body.alternateIndices?.[0];
    const modPatch =
      modIdx !== undefined && card?.alternates?.[modIdx]
        ? (card.alternates[modIdx]?.argsPatch ?? ({} as Record<string, unknown>))
        : ({} as Record<string, unknown>);
    return withNote({
      ...modPatch,
      decision: 'modify',
      overrideUserIds: body.overrideUserIds ?? [],
      ...(body.alternateIndices ? { alternateIndices: body.alternateIndices } : {}),
    } as ResumeDecisionData);
  }

  // approve: merge full argsPatch from the chosen card option so both staffing
  // (assigneeUserIds) and PMO (approvedItemKey, mappingOverrides, proceedToNextStep,
  // report-range date params, plannerStepId, etc.) fields are forwarded.
  const idx = body.alternateIndices?.[0];
  if (idx !== undefined && card?.alternates?.[idx]) {
    const altPatch = (card.alternates[idx]?.argsPatch ?? {}) as Record<string, unknown>;
    const overrideUserIds = Array.isArray(altPatch.assigneeUserIds)
      ? (altPatch.assigneeUserIds as string[])
      : [];
    return withNote({
      ...altPatch,
      decision: 'approve',
      overrideUserIds,
      alternateIndices: body.alternateIndices,
    } as ResumeDecisionData);
  }

  const primaryPatch = (card?.primary?.argsPatch ?? {}) as Record<string, unknown>;
  const overrideUserIds = Array.isArray(primaryPatch.assigneeUserIds)
    ? (primaryPatch.assigneeUserIds as string[])
    : [];
  return withNote({ ...primaryPatch, decision: 'approve', overrideUserIds } as ResumeDecisionData);
}

/**
 * POST /api/agent/v1/chat/resume — resume a suspended native-suspend agentic
 * HITL run. Records the decision (shared decide core) then re-enters the
 * suspended proposeAssignment composite via the injected resumeOrchestration,
 * streaming its narration back as SSE.
 */
export function mountChatResumeRoute(app: Hono<AgentRouteEnv>, deps: AgentRouteDeps): void {
  app.post('/api/agent/v1/chat/resume', async (c) => {
    const session = c.get('session') as import('../types.ts').SessionLike | undefined;
    if (!session) {
      return c.json({ error: 'unauthorized', message: 'session required' }, 401);
    }
    if (!session.effective_permissions.has('agent.workflow.approve')) {
      return c.json({ error: 'forbidden', message: 'agent.workflow.approve required' }, 403);
    }
    if (!deps.resumeOrchestration && !deps.resumeOrchestrations) {
      return c.json({ error: 'not_supported', message: 'chat resume runtime not configured' }, 500);
    }

    const parsed = ResumeBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { error: 'validation_failed', message: 'bad body', details: parsed.error.format() },
        400,
      );
    }
    const body = parsed.data;

    let ctx: Awaited<ReturnType<typeof recordApprovalDecision>>;
    try {
      ctx = await recordApprovalDecision({
        session,
        approvalId: body.approvalId,
        decision: body.decision,
        overrideUserIds: body.overrideUserIds,
        payloadPatch: body.payloadPatch,
        note: body.note,
        // Reject a misrouted evented/canvas approval INSIDE the transaction
        // (before any write) so a non-resumable row never records a decision.
        requireMastraRun: true,
      });
    } catch (err) {
      return handleDomainError(c, err);
    }

    // requireMastraRun guarantees this is set; narrow the type for the resume call.
    if (ctx.mastraRunId == null) {
      return c.json({ error: 'not_resumable', message: 'approval is not resumable' }, 409);
    }

    const resume = mapDecisionToResumeData(ctx.proposedPayload as ApprovalCard | null, {
      decision: body.decision,
      overrideUserIds: body.overrideUserIds,
      alternateIndices: body.alternateIndices,
      payloadPatch: body.payloadPatch,
      note: body.note,
      clarificationMessage: body.clarificationMessage,
    });

    // Dispatch to the correct resumer based on the approval row's workflow_id.
    const agentForWorkflow: ChatAgent =
      ctx.workflowId === PMO_ORCHESTRATOR_WORKFLOW_ID ? 'pmo' : 'staffing';
    const resumeOrchestration =
      deps.resumeOrchestrations?.[agentForWorkflow] ?? deps.resumeOrchestration;
    if (!resumeOrchestration) {
      return c.json(
        {
          error: 'not_supported',
          message: `no resume runtime configured for ${agentForWorkflow} agent`,
        },
        500,
      );
    }
    const mastraRunId = ctx.mastraRunId;
    const toolCallId = ctx.toolCallId ?? undefined;
    const threadId = ctx.surfaceChatThreadId ?? undefined;

    // When the resumed agent continues and suspends again (e.g. profiling
    // approved -> agent calls column mapping -> suspends), we must write the
    // new approval row. Without this, the subsequent HITL card never appears
    // in the pending-approvals DB poll and PMO workflow cards show empty.
    const workflowIdForResume =
      ctx.workflowId === PMO_ORCHESTRATOR_WORKFLOW_ID
        ? PMO_ORCHESTRATOR_WORKFLOW_ID
        : STAFFING_ORCHESTRATOR_WORKFLOW_ID;
    const onApproval = async (ev: ApprovalEvent): Promise<void> => {
      try {
        await writeChatApprovalRow({
          card: ev.card,
          mastraRunId: ev.mastraRunId,
          toolCallId: ev.toolCallId,
          threadId: threadId ?? null,
          tenantId: session.tenant_id,
          userId: session.user_id,
          pool: deps.pool,
          workflowId: workflowIdForResume,
        });
      } catch (err) {
        if (err instanceof PendingAssignmentExistsError) return;
        (deps.log?.error ?? console.error)(
          { subsystem: 'agent.chat.resume', event: 'onApproval.write.failed', threadId, err },
          'failed to write chat approval row on resume — continuing turn',
        );
      }
    };

    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        const run = await resumeOrchestration(resume, {
          tenantId: session.tenant_id,
          actorUserId: session.user_id,
          threadId,
          mastraRunId,
          toolCallId,
        });
        const aiParts = toAISdkStream(run.output, {
          from: 'agent',
          version: 'v6',
          sendReasoning: true,
          sendStart: true,
          sendFinish: true,
          onError: (e: unknown) => String(e),
        });
        await pumpOrchestrationStream(
          writer as unknown as import('../orchestration-ui-stream.ts').UiStreamWriter,
          aiParts as AsyncIterable<{ type: string; delta?: string; data?: unknown }>,
          { finalize: run.finalize, onApproval },
        );
      },
    });
    return createUIMessageStreamResponse({ stream: uiStream, headers: NO_BUFFER_HEADERS });
  });
}
