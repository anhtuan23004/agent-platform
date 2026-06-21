import type { WorkerHandle } from '@seta/core';

export interface PlanGenerationJobPayload {
  tenantId: string;
  userId: string;
  sessionId: string;
  goal: string;
  planFeedback?: string;
  previousPlan?: unknown;
}

export function planGenerationJobKey(sessionId: string): string {
  return `pmo-plan:${sessionId}`;
}

export async function enqueuePlanGeneration(
  workers: WorkerHandle,
  payload: PlanGenerationJobPayload,
): Promise<void> {
  await workers.addJob('pmo.plan.generate', payload, {
    jobKey: planGenerationJobKey(payload.sessionId),
    maxAttempts: 1,
    queueName: 'pmo-plan',
  });
}
