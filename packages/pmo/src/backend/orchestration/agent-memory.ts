/**
 * CRUD functions for the `pmo.agent_task_state` table — the agent's
 * cross-turn working memory. Every mutation touches `updated_at`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import {
  type AgentBlockerEntry,
  type AgentDecisionEntry,
  type AgentTaskEntry,
  agentTaskState,
} from '../db/schema.ts';

// ── Row / input types ───────────────────────────────────────────────────────

export interface AgentTaskStateRow {
  id: string;
  tenantId: string;
  threadId: string;
  sessionId: string | null;
  originalGoal: string;
  decomposedTasks: AgentTaskEntry[];
  currentTaskIndex: number;
  decisions: AgentDecisionEntry[];
  blockers: AgentBlockerEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAgentTaskState {
  tenantId: string;
  threadId: string;
  sessionId?: string | null;
  originalGoal: string;
  decomposedTasks: AgentTaskEntry[];
  currentTaskIndex: number;
  decisions: AgentDecisionEntry[];
  blockers: AgentBlockerEntry[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToModel(row: typeof agentTaskState.$inferSelect): AgentTaskStateRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id,
    sessionId: row.session_id,
    originalGoal: row.original_goal,
    decomposedTasks: (row.decomposed_tasks ?? []) as AgentTaskEntry[],
    currentTaskIndex: row.current_task_index,
    decisions: (row.decisions ?? []) as AgentDecisionEntry[],
    blockers: (row.blockers ?? []) as AgentBlockerEntry[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Load ────────────────────────────────────────────────────────────────────

export async function loadAgentTaskState(
  tenantId: string,
  threadId: string,
): Promise<AgentTaskStateRow | null> {
  const db = pmoDb();
  const rows = await db
    .select()
    .from(agentTaskState)
    .where(and(eq(agentTaskState.tenant_id, tenantId), eq(agentTaskState.thread_id, threadId)))
    .limit(1);
  const row = rows[0];
  return row ? rowToModel(row) : null;
}

// ── Upsert ──────────────────────────────────────────────────────────────────

export async function upsertAgentTaskState(state: UpsertAgentTaskState): Promise<void> {
  const db = pmoDb();
  const now = new Date();
  await db
    .insert(agentTaskState)
    .values({
      tenant_id: state.tenantId,
      thread_id: state.threadId,
      session_id: state.sessionId ?? null,
      original_goal: state.originalGoal,
      decomposed_tasks: state.decomposedTasks,
      current_task_index: state.currentTaskIndex,
      decisions: state.decisions,
      blockers: state.blockers,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [agentTaskState.tenant_id, agentTaskState.thread_id],
      set: {
        session_id: state.sessionId ?? null,
        original_goal: state.originalGoal,
        decomposed_tasks: state.decomposedTasks,
        current_task_index: state.currentTaskIndex,
        decisions: state.decisions,
        blockers: state.blockers,
        updated_at: now,
      },
    });
}

// ── Append decision ─────────────────────────────────────────────────────────

export async function appendDecision(
  tenantId: string,
  threadId: string,
  decision: AgentDecisionEntry,
): Promise<void> {
  const db = pmoDb();
  await db
    .update(agentTaskState)
    .set({
      decisions: sql`${agentTaskState.decisions} || ${JSON.stringify([{ ...decision, timestamp: decision.timestamp || new Date().toISOString() }])}::jsonb`,
      updated_at: new Date(),
    })
    .where(and(eq(agentTaskState.tenant_id, tenantId), eq(agentTaskState.thread_id, threadId)));
}

// ── Append blocker ──────────────────────────────────────────────────────────

export async function appendBlocker(
  tenantId: string,
  threadId: string,
  blocker: AgentBlockerEntry,
): Promise<void> {
  const db = pmoDb();
  await db
    .update(agentTaskState)
    .set({
      blockers: sql`${agentTaskState.blockers} || ${JSON.stringify([blocker])}::jsonb`,
      updated_at: new Date(),
    })
    .where(and(eq(agentTaskState.tenant_id, tenantId), eq(agentTaskState.thread_id, threadId)));
}

// ── Update single task status ───────────────────────────────────────────────

/**
 * Load-mutate-save for a single task's status and optional result summary.
 * Finds the task by `taskId` within `decomposed_tasks` and patches it.
 * No-ops silently if the row or task does not exist.
 */
export async function updateTaskStatus(
  tenantId: string,
  threadId: string,
  taskId: string,
  status: AgentTaskEntry['status'],
  resultSummary?: string,
): Promise<void> {
  const existing = await loadAgentTaskState(tenantId, threadId);
  if (!existing) return;

  const tasks = [...existing.decomposedTasks];
  const idx = tasks.findIndex((t) => t.taskId === taskId);
  const target = tasks[idx];
  if (idx === -1 || !target) return;

  tasks[idx] = {
    ...target,
    status,
    ...(resultSummary !== undefined ? { resultSummary } : {}),
  };

  const db = pmoDb();
  await db
    .update(agentTaskState)
    .set({ decomposed_tasks: tasks, updated_at: new Date() })
    .where(and(eq(agentTaskState.tenant_id, tenantId), eq(agentTaskState.thread_id, threadId)));
}

// ── Resolve blocker ─────────────────────────────────────────────────────────

export async function resolveBlocker(
  tenantId: string,
  threadId: string,
  blockerIndex: number,
  resolution: string,
): Promise<void> {
  // Load-mutate-save: Drizzle does not support jsonb array element update by
  // index natively, and a raw `jsonb_set` expression is fragile for nested
  // array-index paths. The row is small and contention is negligible (one
  // agent per thread).
  const existing = await loadAgentTaskState(tenantId, threadId);
  if (!existing) return;

  const blockers = [...existing.blockers];
  const target = blockers[blockerIndex];
  if (blockerIndex < 0 || blockerIndex >= blockers.length || !target) return;

  blockers[blockerIndex] = {
    description: target.description,
    resolved: true,
    resolution,
  };

  const db = pmoDb();
  await db
    .update(agentTaskState)
    .set({ blockers, updated_at: new Date() })
    .where(and(eq(agentTaskState.tenant_id, tenantId), eq(agentTaskState.thread_id, threadId)));
}
