import { describe, expect, it } from 'vitest';
import { pickDefaultWorkflowCard } from '../../../../../src/modules/pmo/components/pmo-workflow-cards-section';

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
