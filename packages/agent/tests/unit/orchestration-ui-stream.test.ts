import { describe, expect, it } from 'vitest';
import { pumpOrchestrationStream } from '../../src/backend/orchestration-ui-stream.ts';

interface Chunk {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
  data?: unknown;
}

class FakeWriter {
  chunks: Chunk[] = [];
  write(c: Chunk) {
    this.chunks.push(c);
  }
}

async function* parts(...p: Chunk[]) {
  for (const x of p) yield x;
}

const TRUST = { reasoningTrace: [], evidenceCitations: [], confidenceScore: 0.8 };

describe('pumpOrchestrationStream', () => {
  it('writes every part through and accumulates text for persistence', async () => {
    const w = new FakeWriter();
    const { assistantParts } = await pumpOrchestrationStream(
      w,
      parts(
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Hello ' },
        { type: 'text-delta', id: 't', delta: 'world' },
        { type: 'text-end', id: 't' },
      ),
      {
        finalize: async () => ({ result: { skills: ['aws'] }, trust: TRUST }),
        onApproval: async () => {},
      },
    );
    expect(w.chunks.some((c) => c.type === 'text-delta' && c.delta === 'Hello ')).toBe(true);
    expect(assistantParts).toContainEqual({ type: 'text', text: 'Hello world' });
    expect(assistantParts).toContainEqual({
      type: 'data-result',
      id: 'result',
      data: { skills: ['aws'] },
    });
    expect(assistantParts).toContainEqual({ type: 'data-trust', id: 'trust', data: TRUST });
    expect(w.chunks.some((c) => c.type === 'data-result')).toBe(true);
    expect(w.chunks.some((c) => c.type === 'data-trust')).toBe(true);
  });

  it('fires onApproval and skips finalize when the run suspends', async () => {
    const w = new FakeWriter();
    const card = {
      toolCallId: 'tc-1',
      intent: 'Assign',
      riskBadge: 'write' as const,
      summary: 's',
      details: [],
      primary: { label: 'Assign', argsPatch: { taskId: 't-1' } },
      alternates: [],
      decline: { label: 'No' },
      meta: {
        tenantId: 'ten',
        userId: 'usr',
        agentPath: ['staffing', 'orchestrator'],
        toolId: 'staffing_proposeAssignment',
        ts: new Date().toISOString(),
      },
    };
    const seen: unknown[] = [];
    let finalizeCalled = false;
    const { assistantParts } = await pumpOrchestrationStream(
      w,
      parts(
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Let me assign that.' },
        { type: 'text-end', id: 't' },
        {
          type: 'data-tool-call-suspended',
          data: { runId: 'run-abc', toolCallId: 'tc-1', suspendPayload: { card } },
        },
      ),
      {
        finalize: async () => {
          finalizeCalled = true;
          return { result: {}, trust: TRUST };
        },
        onApproval: async (e) => {
          seen.push(e);
        },
      },
    );
    expect(seen).toEqual([{ card, mastraRunId: 'run-abc', toolCallId: 'tc-1' }]);
    expect(finalizeCalled).toBe(false);
    expect(w.chunks.some((c) => c.type === 'data-tool-call-suspended')).toBe(false);
    expect(assistantParts.some((p) => p.type === 'data-result')).toBe(false);
    expect(assistantParts).toContainEqual({ type: 'text', text: 'Let me assign that.' });
  });

  it('fires onApproval even when the stream errors after suspend', async () => {
    const w = new FakeWriter();
    const card = {
      toolCallId: 'tc-2',
      intent: 'Profile workbook',
      riskBadge: 'write' as const,
      summary: 's',
      details: [],
      primary: { label: 'Approve' },
      alternates: [],
      decline: { label: 'Reject' },
      meta: {
        tenantId: 'ten',
        userId: 'usr',
        agentPath: ['pmo', 'orchestrator'],
        toolId: 'pmo_profileWorkbook',
        ts: new Date().toISOString(),
      },
    };
    const seen: unknown[] = [];

    // Simulate a stream that emits the suspend chunk then errors — e.g. the
    // Mastra agent loop continues after native-suspend returns and a
    // subsequent transform throws.
    async function* errorAfterSuspend() {
      yield { type: 'text-start', id: 't' } as Chunk;
      yield { type: 'text-delta', id: 't', delta: 'Profiling…' } as Chunk;
      yield {
        type: 'data-tool-call-suspended',
        data: { runId: 'run-xyz', toolCallId: 'tc-2', suspendPayload: { card } },
      } as Chunk;
      // Post-suspend chunks that the agent loop might produce before erroring.
      yield { type: 'text-delta', id: 't', delta: ' done' } as Chunk;
      throw new Error('stream transform error after suspend');
    }

    const { assistantParts } = await pumpOrchestrationStream(w, errorAfterSuspend(), {
      finalize: async () => ({ result: {}, trust: TRUST }),
      onApproval: async (e) => {
        seen.push(e);
      },
    });

    // The critical assertion: onApproval MUST fire despite the stream error.
    expect(seen).toEqual([{ card, mastraRunId: 'run-xyz', toolCallId: 'tc-2' }]);
    // Text accumulated before the error is still captured.
    expect(assistantParts).toContainEqual({ type: 'text', text: 'Profiling… done' });
  });

  it('re-throws the stream error when there is no suspend', async () => {
    const w = new FakeWriter();

    async function* errorNoSuspend() {
      yield { type: 'text-delta', id: 't', delta: 'oops' } as Chunk;
      throw new Error('fatal stream error');
    }

    await expect(
      pumpOrchestrationStream(w, errorNoSuspend(), {
        finalize: async () => ({ result: {}, trust: TRUST }),
        onApproval: async () => {},
      }),
    ).rejects.toThrow('fatal stream error');
  });
});
