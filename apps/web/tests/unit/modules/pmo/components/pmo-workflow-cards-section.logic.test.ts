import { describe, expect, it } from 'vitest';
import {
  buildWorkflowCards,
  pickDefaultWorkflowCard,
} from '../../../../../src/modules/pmo/components/pmo-workflow-cards-section.logic';
import type { ExecutionCard } from '../../../../../src/modules/pmo/pages/pmo-page.logic';

describe('pickDefaultWorkflowCard', () => {
  it('opens the first completed step in read-only history mode', () => {
    const cards = [
      {
        id: 'execution-1',
        ordinal: 1,
        kind: 'execution' as const,
        label: 'Workbook Profiling',
        statusLabel: 'Completed',
        access: 'history_view_only' as const,
      },
      {
        id: 'execution-2',
        ordinal: 2,
        kind: 'execution' as const,
        label: 'Publish Review',
        statusLabel: 'Completed',
        access: 'history_view_only' as const,
      },
    ];

    expect(pickDefaultWorkflowCard(cards, true)?.id).toBe('execution-1');
  });

  it('prefers the actionable step when one exists', () => {
    const cards = [
      {
        id: 'execution-1',
        ordinal: 1,
        kind: 'execution' as const,
        label: 'Workbook Profiling',
        statusLabel: 'Completed',
        access: 'history_view_only' as const,
      },
      {
        id: 'execution-2',
        ordinal: 2,
        kind: 'execution' as const,
        label: 'Column Mapping',
        statusLabel: 'Needs review',
        access: 'current_actionable' as const,
      },
    ];

    expect(pickDefaultWorkflowCard(cards, true)?.id).toBe('execution-2');
  });
});

describe('buildWorkflowCards', () => {
  const executionCards: ExecutionCard[] = [
    {
      step_no: 1,
      planner_step_id: 'pmo.planner.step.1.workbook_profiling',
      action_id: 'workbook_profiling',
      review_type: 'profiling',
      step_name: 'Workbook Profiling',
      status: 'pending',
      description: '',
    },
    {
      step_no: 2,
      planner_step_id: 'pmo.planner.step.2.column_mapping',
      action_id: 'column_mapping',
      review_type: 'mapping',
      step_name: 'Column Mapping',
      status: 'completed',
      description: '',
    },
  ];

  it('marks every step as history viewable in read-only history mode', () => {
    const cards = buildWorkflowCards({
      executionCards,
      runtime: {
        executionCurrentStepNo: 2,
        executionCurrentStepStatus: 'completed',
        firstExecutionStepNo: 1,
        runtimeActiveStepId: null,
        hasRuntimeCurrentStepMatch: false,
        approvalByActionId: {},
      },
      readOnly: true,
    });

    expect(cards.every((card) => card.access === 'history_view_only')).toBe(true);
    expect(pickDefaultWorkflowCard(cards, true)?.id).toBe('execution-1');
  });
});
