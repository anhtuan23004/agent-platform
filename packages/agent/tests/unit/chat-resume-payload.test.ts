import { describe, expect, it } from 'vitest';
import { mapDecisionToResumeData } from '../../src/backend/routes/chat-resume.ts';

describe('mapDecisionToResumeData', () => {
  it('forwards a PMO date-range payload patch into native workflow resume data', () => {
    const result = mapDecisionToResumeData(
      {
        toolCallId: 'workflow:run-1:pmo_confirmReportRange',
        intent: 'Confirm PMO report date range',
        riskBadge: 'write',
        summary: 'Confirm range',
        details: [],
        primary: {
          label: 'Generate report',
          argsPatch: { decision: 'approve' },
        },
        alternates: [],
        decline: { label: 'Skip report', argsPatch: { decision: 'reject' } },
        meta: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          agentPath: ['supervisor', 'work', 'pmo'],
          toolId: 'pmo_confirmReportRange',
          ts: '2026-06-21T00:00:00.000Z',
        },
      },
      {
        decision: 'approve',
        payloadPatch: {
          dateRange: { from: '2026-06-29', to: '2026-08-07' },
          dateRangeStrategy: 'manual_database',
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'approve',
      dateRange: { from: '2026-06-29', to: '2026-08-07' },
      dateRangeStrategy: 'manual_database',
    });
  });
});
