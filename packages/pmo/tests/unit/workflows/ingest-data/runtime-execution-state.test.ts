import { describe, expect, it } from 'vitest';
import {
  readCurrentStepName,
  upsertRuntimeExecutionState,
} from '../../../../src/backend/workflows/ingest-data/runtime-execution-state.ts';

const plannerPlan = {
  proposed_workflow: [
    {
      step_no: 1,
      step_name: 'Workbook Profiling',
    },
    {
      step_no: 2,
      step_name: 'Mapping proposal and validation',
    },
    {
      step_no: 3,
      step_name: 'Normalization and DB diff',
    },
    {
      step_no: 4,
      step_name: 'Publish after approval',
    },
  ],
};

describe('upsertRuntimeExecutionState', () => {
  it('initializes from planner workflow and tracks detect -> confirm progression', () => {
    const detectState = upsertRuntimeExecutionState({
      existingState: null,
      planningPlan: plannerPlan,
      runtimeStepId: 'pmo.ingest.detect',
      transition: 'completed',
      nowIso: '2026-06-16T10:00:00.000Z',
    });

    expect(detectState.current_step_no).toBe(2);
    expect(detectState.current_step_status).toBe('in_progress');
    expect(detectState.steps.find((step) => step.step_no === 1)?.status).toBe('completed');
    expect(detectState.steps.find((step) => step.step_no === 2)?.status).toBe('in_progress');

    const confirmReviewState = upsertRuntimeExecutionState({
      existingState: detectState,
      planningPlan: plannerPlan,
      runtimeStepId: 'pmo.ingest.confirmMapping',
      transition: 'needs_review',
      nowIso: '2026-06-16T10:05:00.000Z',
    });

    expect(confirmReviewState.current_step_no).toBe(2);
    expect(confirmReviewState.current_step_status).toBe('needs_review');
    expect(confirmReviewState.steps.find((step) => step.step_no === 2)?.status).toBe(
      'needs_review',
    );
    expect(readCurrentStepName(confirmReviewState)).toBe('Mapping proposal and validation');
  });

  it('moves from mapping confirmation to normalization when planner has a normalization step', () => {
    const mappingReviewState = {
      state_version: 1 as const,
      started_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:10:00.000Z',
      current_step_no: 2,
      current_step_status: 'needs_review' as const,
      steps: [
        {
          step_no: 1,
          step_name: 'Workbook Profiling',
          status: 'completed' as const,
        },
        {
          step_no: 2,
          step_name: 'Mapping proposal and validation',
          status: 'needs_review' as const,
        },
        {
          step_no: 3,
          step_name: 'Normalization and DB diff',
          status: 'pending' as const,
        },
        {
          step_no: 4,
          step_name: 'Publish after approval',
          status: 'pending' as const,
        },
      ],
      documents: [],
      profiling_summary: null,
      profiling_review: null,
    };

    const nextState = upsertRuntimeExecutionState({
      existingState: mappingReviewState,
      planningPlan: plannerPlan,
      runtimeStepId: 'pmo.ingest.confirmMapping',
      transition: 'completed',
      nowIso: '2026-06-16T10:15:00.000Z',
    });

    expect(nextState.current_step_no).toBe(3);
    expect(nextState.current_step_status).toBe('in_progress');
    expect(nextState.steps.find((step) => step.step_no === 2)?.status).toBe('completed');
    expect(nextState.steps.find((step) => step.step_no === 3)?.status).toBe('in_progress');
    expect(readCurrentStepName(nextState)).toBe('Normalization and DB diff');
  });

  it('does not move backward when execution has already advanced beyond matched runtime step', () => {
    const advancedState = {
      state_version: 1 as const,
      started_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:20:00.000Z',
      current_step_no: 3,
      current_step_status: 'in_progress' as const,
      steps: [
        {
          step_no: 1,
          step_name: 'Workbook Profiling',
          status: 'completed' as const,
        },
        {
          step_no: 2,
          step_name: 'Mapping proposal and validation',
          status: 'completed' as const,
        },
        {
          step_no: 3,
          step_name: 'Normalization and DB diff',
          status: 'in_progress' as const,
        },
        {
          step_no: 4,
          step_name: 'Publish after approval',
          status: 'pending' as const,
        },
      ],
      documents: [],
      profiling_summary: null,
      profiling_review: null,
    };

    const nextState = upsertRuntimeExecutionState({
      existingState: advancedState,
      planningPlan: plannerPlan,
      runtimeStepId: 'pmo.ingest.confirmMapping',
      transition: 'completed',
      nowIso: '2026-06-16T10:21:00.000Z',
    });

    expect(nextState.current_step_no).toBe(4);
    expect(nextState.current_step_status).toBe('in_progress');
    expect(nextState.steps.find((step) => step.step_no === 3)?.status).toBe('completed');
    expect(nextState.steps.find((step) => step.step_no === 4)?.status).toBe('in_progress');
  });

  it('marks remaining non-terminal steps as cancelled when current status is cancelled', () => {
    const cancelledBase = {
      state_version: 1 as const,
      started_at: '2026-06-16T10:00:00.000Z',
      updated_at: '2026-06-16T10:30:00.000Z',
      current_step_no: 2,
      current_step_status: 'cancelled' as const,
      steps: [
        {
          step_no: 1,
          step_name: 'Workbook Profiling',
          status: 'completed' as const,
        },
        {
          step_no: 2,
          step_name: 'Mapping proposal and validation',
          status: 'cancelled' as const,
        },
        {
          step_no: 3,
          step_name: 'Normalization and DB diff',
          status: 'pending' as const,
        },
      ],
      documents: [],
      profiling_summary: null,
      profiling_review: null,
    };

    const nextState = upsertRuntimeExecutionState({
      existingState: cancelledBase,
      planningPlan: plannerPlan,
      runtimeStepId: 'pmo.ingest.normalizeToStaging',
      transition: 'in_progress',
      nowIso: '2026-06-16T10:31:00.000Z',
    });

    expect(nextState.current_step_status).toBe('cancelled');
    expect(nextState.steps.find((step) => step.step_no === 2)?.status).toBe('cancelled');
    expect(nextState.steps.find((step) => step.step_no === 3)?.status).toBe('pending');
  });
});
