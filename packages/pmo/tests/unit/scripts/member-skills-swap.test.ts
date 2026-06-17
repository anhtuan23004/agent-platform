import { describe, expect, it } from 'vitest';

import {
  buildMemberSkillsProfiles,
  evaluateSkillFit,
  type MemberSkillsProfile,
  type MemberTaskHistoryEntry,
  proposeRebalanceSwaps,
  rankRebalanceCandidates,
} from '../../../scripts/lib/mock-member-skills-history.ts';

const beProfile = (id: string, name: string): MemberSkillsProfile => ({
  member_id: id,
  full_name: name,
  department: 'Backend',
  role_title: 'Backend Developer',
  level: 'L3',
  allocation_roles: ['BE'],
  skills: [
    'java',
    'spring-boot',
    'rest-api',
    'microservices',
    'sql',
    'postgresql',
    'backend',
    'be',
  ],
  primary_skills: ['java', 'spring-boot', 'rest-api', 'microservices', 'sql', 'postgresql'],
});

const devopsProfile = (id: string, name: string): MemberSkillsProfile => ({
  member_id: id,
  full_name: name,
  department: 'Platform',
  role_title: 'DevOps Engineer',
  level: 'L4',
  allocation_roles: ['DevOps'],
  skills: ['kubernetes', 'terraform', 'ci-cd', 'aws', 'monitoring', 'docker', 'devops'],
  primary_skills: ['kubernetes', 'terraform', 'ci-cd', 'aws', 'monitoring', 'docker'],
});

const baProfile = (id: string, name: string): MemberSkillsProfile => ({
  member_id: id,
  full_name: name,
  department: 'BA',
  role_title: 'Business Analyst',
  level: 'L3',
  allocation_roles: ['BA'],
  skills: [
    'requirements',
    'user-stories',
    'process-modelling',
    'stakeholder-mgmt',
    'confluence',
    'ba',
  ],
  primary_skills: [
    'requirements',
    'user-stories',
    'process-modelling',
    'stakeholder-mgmt',
    'confluence',
  ],
});

describe('member skills swap', () => {
  it('allows BE → BE swap when role skills overlap', () => {
    const source = beProfile('EMP-004', 'Dung');
    const target = beProfile('EMP-103', 'Nam');
    const fit = evaluateSkillFit({
      source,
      target,
      role: 'BE',
      history: [],
    });
    expect(fit.can_swap).toBe(true);
    expect(fit.matched_skills.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects BE → DevOps swap (wrong role)', () => {
    const fit = evaluateSkillFit({
      source: beProfile('EMP-004', 'Dung'),
      target: devopsProfile('EMP-005', 'Em'),
      role: 'BE',
      history: [],
    });
    expect(fit.can_swap).toBe(false);
  });

  it('ranks EMP-103 above EMP-005 for overbooked BE', () => {
    const profiles = [
      beProfile('EMP-004', 'Dung'),
      devopsProfile('EMP-005', 'Em'),
      baProfile('EMP-008', 'Lan'),
      beProfile('EMP-103', 'Nam'),
    ];
    const ranked = rankRebalanceCandidates({
      overbookMemberId: 'EMP-004',
      candidateMemberIds: ['EMP-005', 'EMP-008', 'EMP-103'],
      profiles,
      history: [],
      overbookProjectIds: ['PRJ-001'],
    });
    const swappable = ranked.filter((r) => r.can_swap);
    expect(swappable[0]?.member_id).toBe('EMP-103');
    expect(swappable.some((r) => r.member_id === 'EMP-005')).toBe(false);
  });

  it('proposes concrete BE swaps from PMO_02-shaped capacities', () => {
    const profiles = [
      beProfile('EMP-004', 'Dung'),
      beProfile('EMP-103', 'Nam'),
      devopsProfile('EMP-005', 'Em'),
    ];
    const history: MemberTaskHistoryEntry[] = [
      {
        history_id: 'h1',
        member_id: 'EMP-103',
        project_id: 'PRJ-103',
        project_name: 'Lyra',
        project_type: 'Software/Migration',
        allocation_role: 'BE',
        task_title: 'API endpoint implementation',
        task_summary: '',
        total_logged_hours: 80,
        skill_tags: ['java', 'spring-boot'],
      },
    ];
    const swaps = proposeRebalanceSwaps({
      profiles,
      history,
      allocations: [
        {
          member_id: 'EMP-004',
          project_id: 'PRJ-001',
          project_name: 'Orion',
          project_type: 'Software/Migration',
          role: 'BE',
          weekly_planned_hours: 32,
        },
        {
          member_id: 'EMP-004',
          project_id: 'PRJ-002',
          project_name: 'Energent',
          project_type: 'AI/ML Platform',
          role: 'BE',
          weekly_planned_hours: 18,
        },
        {
          member_id: 'EMP-103',
          project_id: 'PRJ-103',
          project_name: 'Lyra',
          project_type: 'Software/Migration',
          role: 'BE',
          weekly_planned_hours: 34.4,
        },
      ],
      capacities: [
        {
          member_id: 'EMP-004',
          full_name: 'Dung',
          std_hours_week: 40,
          planned_hours: 50,
          busy_rate: 1.25,
          headroom_hours: 0,
        },
        {
          member_id: 'EMP-103',
          full_name: 'Nam',
          std_hours_week: 40,
          planned_hours: 34.4,
          busy_rate: 0.86,
          headroom_hours: 9.6,
        },
        {
          member_id: 'EMP-005',
          full_name: 'Em',
          std_hours_week: 40,
          planned_hours: 24,
          busy_rate: 0.6,
          headroom_hours: 20,
        },
      ],
    });

    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps.every((s) => s.can_swap)).toBe(true);
    expect(swaps.some((s) => s.from_member_id === 'EMP-004' && s.to_member_id === 'EMP-103')).toBe(
      true,
    );
    expect(swaps.some((s) => s.to_member_id === 'EMP-005')).toBe(false);
  });

  it('builds profiles from RA roles in workbook-shaped rows', () => {
    const profiles = buildMemberSkillsProfiles({
      members: [
        {
          member_id: 'EMP-001',
          full_name: 'An',
          department: 'Backend',
          role_title: 'Backend Developer',
          level: 'L3',
        },
      ],
      allocations: [{ member_id: 'EMP-001', project_id: 'PRJ-001', role: 'BE' }],
    });
    expect(profiles[0]?.allocation_roles).toEqual(['BE']);
    expect(profiles[0]?.skills).toContain('java');
    expect(profiles[0]?.skills).toContain('spring-boot');
  });
});
