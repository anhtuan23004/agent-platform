import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setConversationMemory } from '../../src/conversation-memory.ts';
import { __resetMutexesForTests, recordEntityExposure } from '../../src/entity-recorder.ts';
import {
  type ConversationEntities,
  EMPTY_ENTITIES,
  parseEntities,
  serializeEntities,
} from '../../src/working-memory-schema.ts';

// The conversation memory is a process-local holder, NOT carried on the
// RequestContext (Mastra serializes the RequestContext around tool execution,
// stripping a live Memory's prototype). buildCtx registers it via the holder
// and the ctx only carries the serializable thread_id.
function buildCtx(initial: ConversationEntities | null, threadId: string | undefined = 'conv-1') {
  let stored: string | null = initial ? serializeEntities(initial) : null;
  const memory = {
    getWorkingMemory: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 0)); // force task-queue yield → interleaves callers
      return stored;
    }),
    updateWorkingMemory: vi.fn(async ({ workingMemory }: { workingMemory: string }) => {
      await new Promise((r) => setTimeout(r, 0)); // yield so both reads land before either write
      stored = workingMemory;
    }),
  };
  setConversationMemory({ memory, memoryConfig: {} } as never);
  return {
    ctx: {
      // ctx.agent carries Mastra's randomized sub-thread id — deliberately
      // different from the real chat thread id, to prove we do NOT use it.
      agent: { threadId: 'mangled-subthread', resourceId: 'user-x-work-planner' },
      requestContext: {
        get: (k: string) => (k === 'thread_id' ? threadId : undefined),
      },
    } as never,
    memory,
    read: () => (stored ? parseEntities(stored) : null),
  };
}

const T1 = { taskId: '00000000-0000-4000-8000-000000000001', title: 'A' };
const T2 = { taskId: '00000000-0000-4000-8000-000000000002', title: 'B' };

describe('recordEntityExposure', () => {
  beforeEach(() => {
    __resetMutexesForTests();
  });
  afterEach(() => setConversationMemory(undefined));

  it('keys writes on the real chat thread id, not ctx.agent.threadId', async () => {
    const { ctx, memory } = buildCtx(null, 'conv-42');
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(memory.getWorkingMemory).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-42' }),
    );
    expect(memory.updateWorkingMemory).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-42' }),
    );
  });

  it('seeds recentTasks on empty memory', async () => {
    const { ctx, read } = buildCtx(null);
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(read()?.recentTasks).toMatchObject([{ taskId: T1.taskId, title: 'A' }]);
  });

  it('merges-by-taskId, refreshes lastSeenAt, sorts desc, keeps unique', async () => {
    const { ctx, read } = buildCtx({
      ...EMPTY_ENTITIES,
      recentTasks: [{ taskId: T1.taskId, title: 'A-old', lastSeenAt: '2020-01-01T00:00:00.000Z' }],
    });
    await recordEntityExposure(ctx, { recentTasks: [T2, T1] });
    const tasks = read()?.recentTasks ?? [];
    expect(tasks.map((t) => t.taskId)).toEqual([T2.taskId, T1.taskId]);
    expect(tasks.at(1)?.title).toBe('A'); // title refreshed
  });

  it('truncates to 10 most recent', async () => {
    const { ctx, read } = buildCtx(null);
    const batch = Array.from({ length: 12 }, (_, i) => ({
      taskId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `T${i}`,
    }));
    await recordEntityExposure(ctx, { recentTasks: batch });
    expect(read()?.recentTasks).toHaveLength(10);
  });

  it('patches scalar entity fields without touching recentTasks', async () => {
    const { ctx, read } = buildCtx({
      ...EMPTY_ENTITIES,
      recentTasks: [{ ...T1, lastSeenAt: '2020-01-01T00:00:00.000Z' }],
    });
    await recordEntityExposure(ctx, { lastDiscussedTaskId: T1.taskId });
    const e = read();
    expect(e?.lastDiscussedTaskId).toBe(T1.taskId);
    expect(e?.recentTasks).toHaveLength(1);
  });

  it('is a no-op when conversation memory is not configured', async () => {
    setConversationMemory(undefined);
    const ctx = {
      requestContext: { get: (k: string) => (k === 'thread_id' ? 'conv-1' : undefined) },
    } as never;
    await expect(recordEntityExposure(ctx, { recentTasks: [T1] })).resolves.toBeUndefined();
  });

  it('is a no-op when no chat thread id is present', async () => {
    const updateWorkingMemory = vi.fn();
    setConversationMemory({
      memory: { getWorkingMemory: vi.fn(), updateWorkingMemory },
      memoryConfig: {},
    } as never);
    const ctx = { requestContext: { get: () => undefined } } as never;
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(updateWorkingMemory).not.toHaveBeenCalled();
  });

  it('serializes concurrent writes per conversation (no lost updates)', async () => {
    const { ctx, read } = buildCtx(null);
    await Promise.all([
      recordEntityExposure(ctx, { recentTasks: [T1] }),
      recordEntityExposure(ctx, { recentTasks: [T2] }),
    ]);
    const ids = (read()?.recentTasks ?? []).map((t) => t.taskId).sort();
    expect(ids).toEqual([T1.taskId, T2.taskId].sort());
  });

  it('records PMO member and date range exposure', async () => {
    const { ctx, read } = buildCtx(null);
    await recordEntityExposure(ctx, {
      lastDiscussedMemberId: 'EMP-004',
      recentMembers: [{ memberId: 'EMP-004', label: 'EMP-004' }],
      lastDateRange: { from: '2026-06-01', to: '2026-06-30' },
      lastIngestionSessionId: '11111111-1111-4111-8111-111111111111',
    });
    const entities = read();
    expect(entities?.lastDiscussedMemberId).toBe('EMP-004');
    expect(entities?.recentMembers).toMatchObject([{ memberId: 'EMP-004', label: 'EMP-004' }]);
    expect(entities?.lastDateRange).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(entities?.lastIngestionSessionId).toBe('11111111-1111-4111-8111-111111111111');
  });
});
