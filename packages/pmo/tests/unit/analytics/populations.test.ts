import { describe, expect, it } from 'vitest';
import { splitPmoPopulations } from '../../../src/backend/analytics/populations.ts';
import type { MemberRow, ProjectRow } from '../../../src/backend/analytics/types.ts';

function member(id: string, roleTitle: string | null = null): MemberRow {
  return {
    member_id: id,
    full_name: id,
    role_title: roleTitle,
    std_hours_week: 40,
    join_date: new Date('2020-01-01T00:00:00.000Z'),
  };
}

function project(id: string, pmId: string | null): ProjectRow {
  return {
    project_id: id,
    project_name: id,
    account_id: null,
    project_type: null,
    status: 'Active',
    pm_id: pmId,
    start_date: null,
    end_date: null,
  };
}

describe('splitPmoPopulations', () => {
  it('separates project managers from delivery members by project pm_id and role title', () => {
    const result = splitPmoPopulations(
      [
        member('EMP-001', 'Backend Developer'),
        member('EMP-011', 'Engineering Manager'),
        member('EMP-012', 'PMO Lead / PM'),
        member('EMP-101', 'Project Manager'),
      ],
      [project('PRJ-001', 'EMP-011')],
    );

    expect(result.deliveryMembers.map((m) => m.member_id)).toEqual(['EMP-001']);
    expect(result.projectManagers.map((m) => m.member_id)).toEqual([
      'EMP-011',
      'EMP-012',
      'EMP-101',
    ]);
  });
});
