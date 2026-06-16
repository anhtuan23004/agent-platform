import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getWorkflowRun } from '../../src/backend/domain/get-workflow-run.ts';
import { getWorkflowRunSnapshot } from '../../src/backend/domain/get-workflow-run-snapshot.ts';
import { initAgentRegistry } from '../../src/backend/init-registry.ts';
import { buildMastra } from '../../src/backend/runtime.ts';
import type { SessionLike } from '../../src/backend/types.ts';
import { onLifecycleEvent } from '../../src/backend/workflows/_infra/lifecycle-hook.ts';
import { withAgentTestDb } from '../helpers.ts';

function sessionWith(perms: string[], tenantId = randomUUID(), userId = randomUUID()): SessionLike {
  return {
    tenant_id: tenantId,
    user_id: userId,
    effective_permissions: new Set(perms),
    role_summary: { roles: [], cross_tenant_read: false },
  };
}

async function seed(
  pool: import('pg').Pool,
  runId: string,
  tenantId: string,
  startedBy: string,
): Promise<void> {
  await onLifecycleEvent(pool, {
    kind: 'run-started',
    runId,
    eventSeq: 1,
    workflowId: 'agent.x',
    tenantId,
    startedBy,
    startedVia: 'event',
    parentThreadId: null,
    parentRunId: null,
    sourceEventId: null,
    inputSummary: {},
    occurredAt: new Date(),
  });
}

describe('getWorkflowRun', () => {
  it('returns own run via read.self', async () => {
    await withAgentTestDb(async ({ pool }) => {
      const me = sessionWith(['agent.workflow.run.read.self']);
      const runId = randomUUID();
      await seed(pool, runId, me.tenant_id, me.user_id);
      const row = await getWorkflowRun({ session: me, runId });
      expect(row?.runId).toBe(runId);
      expect(row?.tenantId).toBe(me.tenant_id);
      expect(row?.startedBy).toBe(me.user_id);
    });
  });

  it('returns null for an other-tenant run (caller has read.self only)', async () => {
    await withAgentTestDb(async ({ pool }) => {
      const me = sessionWith(['agent.workflow.run.read.self']);
      const runId = randomUUID();
      await seed(pool, runId, randomUUID(), randomUUID());
      const row = await getWorkflowRun({ session: me, runId });
      expect(row).toBeNull();
    });
  });

  it('returns same-tenant other-user run when caller holds read.tenant', async () => {
    await withAgentTestDb(async ({ pool }) => {
      const viewer = sessionWith([
        'agent.workflow.run.read.self',
        'agent.workflow.run.read.tenant',
      ]);
      const otherUser = randomUUID();
      const runId = randomUUID();
      await seed(pool, runId, viewer.tenant_id, otherUser);
      const row = await getWorkflowRun({ session: viewer, runId });
      expect(row?.runId).toBe(runId);
      expect(row?.startedBy).toBe(otherUser);
    });
  });

  it('returns any-tenant run when caller holds read.instance', async () => {
    await withAgentTestDb(async ({ pool }) => {
      const admin = sessionWith([
        'agent.workflow.run.read.self',
        'agent.workflow.run.read.instance',
      ]);
      const runId = randomUUID();
      await seed(pool, runId, randomUUID(), randomUUID());
      const row = await getWorkflowRun({ session: admin, runId });
      expect(row?.runId).toBe(runId);
    });
  });

  it('returns null for a non-existent run', async () => {
    await withAgentTestDb(async ({ pool: _pool }) => {
      const me = sessionWith(['agent.workflow.run.read.self']);
      const row = await getWorkflowRun({ session: me, runId: randomUUID() });
      expect(row).toBeNull();
    });
  });
});

describe('getWorkflowRunSnapshot', () => {
  it('returns null when projection denies visibility', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const mastra = buildMastra({ pool, databaseUrl });
      await mastra.getStorage()!.init();
      const me = sessionWith(['agent.workflow.run.read.self']);
      const runId = randomUUID();
      await seed(pool, runId, randomUUID(), randomUUID()); // foreign tenant
      const snap = await getWorkflowRunSnapshot({ session: me, runId, mastra });
      expect(snap).toBeNull();
    });
  });

  it('returns the snapshot when projection visibility passes and Mastra has the run', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage()!;
      await storage.init();
      const workflowsStore = await storage.getStore('workflows');
      if (!workflowsStore) throw new Error('workflows store unavailable');

      const me = sessionWith(['agent.workflow.run.read.self']);
      const runId = randomUUID();
      await seed(pool, runId, me.tenant_id, me.user_id);

      await workflowsStore.persistWorkflowSnapshot({
        workflowName: 'agent.x',
        runId,
        snapshot: {
          runId,
          status: 'running',
          value: {},
          context: {},
          activePaths: [],
          activeStepsPath: {},
          serializedStepGraph: [],
          suspendedPaths: {},
          resumeLabels: {},
          waitingPaths: {},
          timestamp: Date.now(),
        } as Parameters<typeof workflowsStore.persistWorkflowSnapshot>[0]['snapshot'],
      });

      const snap = await getWorkflowRunSnapshot({ session: me, runId, mastra });
      expect(snap).toBeTruthy();
    });
  });

  it('decorates PMO workflow snapshot graph from planner proposed_workflow', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      initAgentRegistry();

      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage()!;
      await storage.init();
      const workflowsStore = await storage.getStore('workflows');
      if (!workflowsStore) throw new Error('workflows store unavailable');

      const me = sessionWith(['agent.workflow.run.read.self']);
      const runId = randomUUID();
      const ingestionSessionId = randomUUID();
      await onLifecycleEvent(pool, {
        kind: 'run-started',
        runId,
        eventSeq: 1,
        workflowId: 'pmo.ingestData.v2',
        tenantId: me.tenant_id,
        startedBy: me.user_id,
        startedVia: 'event',
        parentThreadId: null,
        parentRunId: null,
        sourceEventId: null,
        inputSummary: { ingestionSessionId },
        occurredAt: new Date(),
      });

      await pool.query(
        `
          INSERT INTO pmo.ingestion_sessions (
            id,
            tenant_id,
            status,
            source_file_key,
            source_file_name,
            mime_type,
            created_by,
            planning_plan,
            workflow_execution_state
          ) VALUES (
            $1,
            $2,
            'approved_plan',
            's3://tests/demo.xlsx',
            'demo.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            $3,
            $4::jsonb,
            $5::jsonb
          )
        `,
        [
          ingestionSessionId,
          me.tenant_id,
          me.user_id,
          JSON.stringify({
            proposed_workflow: [
              {
                step_no: 1,
                step_name: 'Workbook profiling',
                description: 'Profile workbook sheets.',
              },
              {
                step_no: 2,
                step_name: 'Mapping proposal and validation',
                description: 'Confirm mappings.',
              },
              {
                step_no: 3,
                step_name: 'Normalization and DB diff',
                description: 'Compute DB diff.',
              },
            ],
          }),
          JSON.stringify({
            current_step_no: 2,
            current_step_status: 'needs_review',
            steps: [
              {
                step_no: 1,
                status: 'completed',
              },
              {
                step_no: 2,
                status: 'needs_review',
              },
            ],
          }),
        ],
      );

      await workflowsStore.persistWorkflowSnapshot({
        workflowName: 'pmo.ingestData.v2',
        runId,
        snapshot: {
          runId,
          status: 'running',
          value: {},
          context: {
            'pmo.ingest.detect': { status: 'success' },
            'pmo.ingest.confirmMapping': { status: 'suspended' },
          },
          activePaths: [],
          activeStepsPath: {},
          serializedStepGraph: [
            {
              type: 'step',
              step: {
                id: 'pmo.ingest.detect',
              },
            },
          ],
          suspendedPaths: {},
          resumeLabels: {},
          waitingPaths: {},
          timestamp: Date.now(),
        } as Parameters<typeof workflowsStore.persistWorkflowSnapshot>[0]['snapshot'],
      });

      const snap = (await getWorkflowRunSnapshot({
        session: me,
        runId,
        mastra,
      })) as {
        serializedStepGraph?: Array<{ type: string; step: { id: string; description?: string } }>;
        context?: Record<string, { status?: string }>;
      } | null;

      expect(snap).not.toBeNull();
      expect(snap?.serializedStepGraph).toEqual([
        {
          type: 'step',
          step: {
            id: '1. Workbook profiling',
            description: 'Profile workbook sheets.',
          },
        },
        {
          type: 'step',
          step: {
            id: '2. Mapping proposal and validation',
            description: 'Confirm mappings.',
          },
        },
        {
          type: 'step',
          step: {
            id: '3. Normalization and DB diff',
            description: 'Compute DB diff.',
          },
        },
      ]);
      expect(snap?.context?.['1. Workbook profiling']?.status).toBe('success');
      expect(snap?.context?.['2. Mapping proposal and validation']?.status).toBe('suspended');
      expect(snap?.context?.['3. Normalization and DB diff']?.status).toBe('pending');
    });
  });
});
