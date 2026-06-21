import { describe, expect, it, vi } from 'vitest';
import {
  enqueuePlanGeneration,
  planGenerationJobKey,
} from '../../../src/backend/planning/jobs/enqueue-plan-generation.ts';
import { runPlanGenerationJob } from '../../../src/backend/planning/jobs/generate-plan.ts';

const payload = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '33333333-3333-4333-8333-333333333333',
  goal: 'Generate a PMO ingestion plan',
};

describe('async PMO plan generation', () => {
  it('uses one tenant-scoped graphile job per session', async () => {
    const addJob = vi.fn(async () => undefined);

    await enqueuePlanGeneration({ addJob, shutdown: async () => undefined }, payload);

    expect(planGenerationJobKey(payload.sessionId)).toBe(`pmo-plan:${payload.sessionId}`);
    expect(addJob).toHaveBeenCalledWith('pmo.plan.generate', payload, {
      jobKey: `pmo-plan:${payload.sessionId}`,
      maxAttempts: 1,
      queueName: 'pmo-plan',
    });
  });

  it('persists plan review after classification and generation', async () => {
    const intent = {
      dataSourceMode: 'uploaded_file',
      actionMode: 'publish_then_report',
      writePolicy: 'requires_approval',
      confidence: 'high',
      rationale: 'Explicit ingest goal',
      allowed_action_ids: ['profile_workbook'],
      requires_confirmation: false,
    } as never;
    const plan = { title: 'Generated plan' } as never;
    const deps = {
      loadSession: vi.fn(async () => ({
        sourceFileKey: 'tenant/file.xlsx',
        sourceFileName: 'file.xlsx',
        sourceFileSizeBytes: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        planningGoal: null,
        planningIntent: null,
        planVersion: 2,
        feedbackHistory: [],
      })),
      classifyIntent: vi.fn(async () => intent),
      generatePlan: vi.fn(async () => plan),
      saveIntentReview: vi.fn(async () => undefined),
      savePlanReview: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };

    await runPlanGenerationJob(payload, deps);

    expect(deps.generatePlan).toHaveBeenCalledWith(
      expect.objectContaining({ goal: payload.goal, intent }),
    );
    expect(deps.savePlanReview).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: payload.tenantId,
        sessionId: payload.sessionId,
        plan,
        planVersion: 3,
      }),
    );
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('persists a retryable failure instead of leaving generating_plan stuck', async () => {
    const deps = {
      loadSession: vi.fn(async () => ({
        sourceFileKey: 'tenant/file.xlsx',
        sourceFileName: 'file.xlsx',
        sourceFileSizeBytes: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        createdAt: new Date('2026-06-21T00:00:00.000Z'),
        planningGoal: null,
        planningIntent: null,
        planVersion: 0,
        feedbackHistory: [],
      })),
      classifyIntent: vi.fn(async () => {
        throw new Error('provider_timeout');
      }),
      generatePlan: vi.fn(),
      saveIntentReview: vi.fn(),
      savePlanReview: vi.fn(),
      markFailed: vi.fn(async () => undefined),
    };

    await expect(runPlanGenerationJob(payload, deps)).rejects.toThrow('provider_timeout');
    expect(deps.markFailed).toHaveBeenCalledWith({
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      message: 'provider_timeout',
    });
  });
});
