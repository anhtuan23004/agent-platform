/**
 * Read-only tool the agent calls at the start of each turn to restore
 * its working memory (goal, task plan, decisions, blockers) and the
 * linked ingestion session status.
 */
import { defineAgentTool, RC_THREAD_ID } from '@seta/agent-sdk';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { tenantIdFromContext } from '../../agent-tools/context.ts';
import { pmoDb } from '../../db/client.ts';
import { ingestionSessions } from '../../db/schema.ts';
import { loadAgentTaskState } from '../agent-memory.ts';

const taskEntrySchema = z.object({
  taskId: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']),
  toolId: z.string().optional(),
  resultSummary: z.string().optional(),
});

const decisionEntrySchema = z.object({
  step: z.string(),
  decision: z.string(),
  userFeedback: z.string().optional(),
  timestamp: z.string(),
});

const blockerEntrySchema = z.object({
  description: z.string(),
  resolved: z.boolean(),
  resolution: z.string().optional(),
});

const recentSessionSchema = z.object({
  sessionId: z.string(),
  status: z.string(),
  createdAt: z.string(),
  rowsPublished: z.number().nullable(),
});

const outputSchema = z.object({
  hasState: z.boolean(),
  goal: z.string().nullable(),
  sessionId: z.string().nullable(),
  tasks: z.array(taskEntrySchema).nullable(),
  currentTaskIndex: z.number().nullable(),
  decisions: z.array(decisionEntrySchema).nullable(),
  blockers: z.array(blockerEntrySchema).nullable(),
  sessionStatus: z.string().nullable(),
  sessionPlanSteps: z.number().nullable(),
  recentSessions: z.array(recentSessionSchema).nullable(),
});

export function makePmoLoadContextTool() {
  return defineAgentTool({
    id: 'pmo_loadContext',
    name: 'Load Context',
    description:
      'Load your persisted task state, active session info, and recent history. ' +
      'Call at the start of each turn to restore your working memory. ' +
      'Returns null fields when no state exists yet.',
    input: z.object({}),
    output: outputSchema,
    execute: async (_input, ctx) => {
      const tenantId = tenantIdFromContext(ctx);
      const threadId = ctx.requestContext?.get(RC_THREAD_ID) as string | undefined;
      if (!threadId) {
        return {
          hasState: false,
          goal: null,
          sessionId: null,
          tasks: null,
          currentTaskIndex: null,
          decisions: null,
          blockers: null,
          sessionStatus: null,
          sessionPlanSteps: null,
          recentSessions: null,
        };
      }

      const state = await loadAgentTaskState(tenantId, threadId);
      if (!state) {
        return {
          hasState: false,
          goal: null,
          sessionId: null,
          tasks: null,
          currentTaskIndex: null,
          decisions: null,
          blockers: null,
          sessionStatus: null,
          sessionPlanSteps: null,
          recentSessions: null,
        };
      }

      // If a session is linked, load its current status and plan step count
      let sessionStatus: string | null = null;
      let sessionPlanSteps: number | null = null;

      if (state.sessionId) {
        const db = pmoDb();
        const [session] = await db
          .select({
            status: ingestionSessions.status,
            planningPlan: ingestionSessions.planning_plan,
          })
          .from(ingestionSessions)
          .where(
            and(
              eq(ingestionSessions.tenant_id, tenantId),
              eq(ingestionSessions.id, state.sessionId),
            ),
          )
          .limit(1);

        if (session) {
          sessionStatus = session.status;
          const plan = session.planningPlan as { steps?: unknown[] } | null;
          sessionPlanSteps = Array.isArray(plan?.steps) ? plan.steps.length : null;
        }
      }

      // Query the 3 most recent ingestion sessions (excluding the current one)
      const db2 = pmoDb();
      const recentConditions = [eq(ingestionSessions.tenant_id, tenantId)];
      if (state.sessionId) {
        recentConditions.push(ne(ingestionSessions.id, state.sessionId));
      }
      const recentRows = await db2
        .select({
          id: ingestionSessions.id,
          status: ingestionSessions.status,
          created_at: ingestionSessions.created_at,
        })
        .from(ingestionSessions)
        .where(and(...recentConditions))
        .orderBy(desc(ingestionSessions.created_at))
        .limit(3);

      const recentSessions = recentRows.map((r) => ({
        sessionId: r.id,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        // Expensive to compute (would need to count staging_changes) — null for now
        rowsPublished: null,
      }));

      return {
        hasState: true,
        goal: state.originalGoal,
        sessionId: state.sessionId,
        tasks: state.decomposedTasks,
        currentTaskIndex: state.currentTaskIndex,
        decisions: state.decisions,
        blockers: state.blockers,
        sessionStatus,
        sessionPlanSteps,
        recentSessions: recentSessions.length > 0 ? recentSessions : null,
      };
    },
  });
}
