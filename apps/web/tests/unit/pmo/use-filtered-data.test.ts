import { describe, expect, it } from 'vitest';
import type { DemoAnalyticsResult } from '../../../src/modules/pmo/api/demo-analytics.ts';
import { filterDemoAnalyticsPopulations } from '../../../src/modules/pmo/pages/demo-calculation/use-filtered-data.logic.ts';

describe('filterDemoAnalyticsPopulations', () => {
  const data = {
    canonical: {
      projects: [
        { projectId: 'PRJ-001', projectName: 'Orion', pmId: 'EMP-012' },
        { projectId: 'PRJ-002', projectName: 'Energent', pmId: 'EMP-012' },
      ],
    },
    populations: {
      deliveryMembers: [{ memberId: 'EMP-004', fullName: 'Pham Thi Dung' }],
      projectManagers: [{ memberId: 'EMP-012', fullName: 'Dang Van Phuc' }],
    },
    projectMemberDependencies: [
      { memberId: 'EMP-004', projectId: 'PRJ-001', pmId: 'EMP-012' },
      { memberId: 'EMP-004', projectId: 'PRJ-002', pmId: 'EMP-012' },
    ],
  } as unknown as DemoAnalyticsResult;

  it('keeps project PMs visible when filtering by a delivery member', () => {
    const populations = filterDemoAnalyticsPopulations(data, 'EMP-004', null);
    expect(populations.deliveryMembers.map((m) => m.memberId)).toEqual(['EMP-004']);
    expect(populations.projectManagers.map((m) => m.memberId)).toEqual(['EMP-012']);
  });
});
