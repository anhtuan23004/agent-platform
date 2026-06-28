/**
 * Internal tool: the agent calls this to persist its own working memory
 * (goal, task plan, decisions, blockers). Does NOT suspend — it is a
 * direct write to the `pmo.agent_task_state` table.
 */
import { defineAgentTool, RC_THREAD_ID } from '@seta/agent-sdk';
import { z } from 'zod';
import { tenantIdFromContext } from '../../agent-tools/context.ts';
import {
  appendBlocker,
  appendDecision,
  resolveBlocker,
  updateTaskStatus,
  upsertAgentTaskState,
} from '../agent-memory.ts';

const taskEntrySchema = z.object({
  taskId: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']),
  toolId: z.string().optional(),
  resultSummary: z.string().optional(),
});

const inputSchema = z.object({
  goal: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  tasks: z.array(taskEntrySchema).optional(),
  currentTaskIndex: z.number().int().min(0).optional(),
  decision: z
    .object({
      step: z.string(),
      decision: z.string(),
      userFeedback: z.string().optional(),
    })
    .optional(),
  blocker: z
    .object({
      description: z.string(),
    })
    .optional(),
  blockerResolution: z
    .object({
      blockerIndex: z.number().int().min(0),
      resolution: z.string(),
    })
    .optional(),
  taskStatusUpdate: z
    .object({
      taskId: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'skipped', 'blocked']),
      resultSummary: z.string().optional(),
    })
    .optional(),
});

const outputSchema = z.object({
  saved: z.boolean(),
  threadId: z.string().optional(),
});

export function makePmoUpdateTaskStateTool() {
  return defineAgentTool({
    id: 'pmo_updateTaskState',
    name: 'Update Task State',
    description:
      'Persist your current goal, task plan, decisions, and blockers. ' +
      'Call after decomposing a goal, completing a task, or recording a user decision. ' +
      'This is your memory — it survives across chat turns.',
    input: inputSchema,
    output: outputSchema,
    execute: async (input, ctx) => {
      const tenantId = tenantIdFromContext(ctx);
      const threadId = ctx.requestContext?.get(RC_THREAD_ID) as string | undefined;
      if (!threadId) {
        return { saved: false };
      }

      // Full state upsert when goal or tasks are provided
      if (input.goal || input.tasks) {
        await upsertAgentTaskState({
          tenantId,
          threadId,
          sessionId: input.sessionId ?? null,
          originalGoal: input.goal ?? '',
          decomposedTasks: input.tasks ?? [],
          currentTaskIndex: input.currentTaskIndex ?? 0,
          decisions: [],
          blockers: [],
        });
      }

      // Append a decision entry
      if (input.decision) {
        await appendDecision(tenantId, threadId, {
          ...input.decision,
          timestamp: new Date().toISOString(),
        });
      }

      // Append a blocker entry
      if (input.blocker) {
        await appendBlocker(tenantId, threadId, {
          description: input.blocker.description,
          resolved: false,
        });
      }

      // Resolve an existing blocker
      if (input.blockerResolution) {
        await resolveBlocker(
          tenantId,
          threadId,
          input.blockerResolution.blockerIndex,
          input.blockerResolution.resolution,
        );
      }

      // Update a single task's status
      if (input.taskStatusUpdate) {
        await updateTaskStatus(
          tenantId,
          threadId,
          input.taskStatusUpdate.taskId,
          input.taskStatusUpdate.status,
          input.taskStatusUpdate.resultSummary,
        );
      }

      return { saved: true, threadId };
    },
  });
}
