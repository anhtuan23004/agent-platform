/**
 * Derive member skills profiles and synthetic task history from PMO_02 canonical
 * data (member master, RA roles, project types, timesheet logs).
 *
 * Excel has no task_ref values — history is inferred from allocation role + project
 * domain + logged hours so rebalance/idle suggestions can rank by skill fit.
 */

export interface MockMemberRow {
  member_id: string;
  full_name: string;
  department: string | null;
  role_title: string | null;
  level: string | null;
}

export interface MockAllocationRow {
  member_id: string;
  project_id: string;
  role: string | null;
  allocation_pct?: number | null;
}

export interface MockProjectRow {
  project_id: string;
  project_name: string;
  project_type: string | null;
}

export interface MockTimesheetRow {
  member_id: string;
  project_id: string | null;
  logged_hours: number;
  log_category: string | null;
}

export interface MemberSkillsProfile {
  member_id: string;
  full_name: string;
  department: string;
  role_title: string;
  level: string;
  /** RA role codes from DS01 (BE, DE, ML, …). */
  allocation_roles: string[];
  /** Normalized skill tags for matching / suggest. */
  skills: string[];
  primary_skills: string[];
}

export interface MemberTaskHistoryEntry {
  history_id: string;
  member_id: string;
  project_id: string;
  project_name: string;
  project_type: string;
  allocation_role: string;
  task_title: string;
  task_summary: string;
  total_logged_hours: number;
  skill_tags: string[];
}

export interface RebalanceSuggestCandidate {
  member_id: string;
  full_name: string;
  score: number;
  matched_skills: string[];
  relevant_projects: string[];
  /** True when role + skill fit is strong enough to absorb work. */
  can_swap: boolean;
  rationale: string;
}

export interface MemberCapacity {
  member_id: string;
  full_name: string;
  std_hours_week: number;
  planned_hours: number;
  busy_rate: number;
  headroom_hours: number;
}

export interface MemberSwapProposal {
  from_member_id: string;
  from_member_name: string;
  to_member_id: string;
  to_member_name: string;
  project_id: string;
  project_name: string;
  role: string;
  transferable_hours: number;
  skill_fit_score: number;
  matched_skills: string[];
  can_swap: boolean;
  rationale: string;
}

export interface SkillFitResult {
  score: number;
  matched_skills: string[];
  can_swap: boolean;
  rationale: string;
}

/** Minimum role-profile skills the target must share to absorb work. */
const MIN_ROLE_SKILL_OVERLAP = 4;
/** Minimum score from rankRebalanceCandidates to mark can_swap. */
const MIN_SWAP_SCORE = 15;

interface RoleProfile {
  skills: string[];
  duties: Array<{ title: string; summary: string; share: number }>;
}

const ROLE_PROFILES: Record<string, RoleProfile> = {
  BE: {
    skills: ['java', 'spring-boot', 'rest-api', 'microservices', 'sql', 'postgresql'],
    duties: [
      {
        title: 'API endpoint implementation',
        summary: 'Build and test REST APIs for core services',
        share: 0.35,
      },
      {
        title: 'Service integration',
        summary: 'Integrate backend services with downstream systems',
        share: 0.3,
      },
      {
        title: 'Bug fixes & code review',
        summary: 'Triage defects and review peer pull requests',
        share: 0.2,
      },
      {
        title: 'Database migration support',
        summary: 'Support schema changes and data migration scripts',
        share: 0.15,
      },
    ],
  },
  DE: {
    skills: ['python', 'spark', 'etl', 'data-pipeline', 'sql', 'airflow'],
    duties: [
      {
        title: 'ETL pipeline development',
        summary: 'Build batch and streaming data pipelines',
        share: 0.4,
      },
      {
        title: 'Data quality checks',
        summary: 'Validate source data and monitor pipeline SLAs',
        share: 0.25,
      },
      {
        title: 'Warehouse modelling',
        summary: 'Design staging and mart tables for analytics',
        share: 0.2,
      },
      {
        title: 'Pipeline operations',
        summary: 'On-call support and incident triage for data jobs',
        share: 0.15,
      },
    ],
  },
  ML: {
    skills: ['python', 'pytorch', 'mlops', 'feature-engineering', 'model-training', 'scikit-learn'],
    duties: [
      {
        title: 'Feature engineering',
        summary: 'Prepare training features from raw platform data',
        share: 0.3,
      },
      {
        title: 'Model training & evaluation',
        summary: 'Train, tune, and benchmark ML models',
        share: 0.35,
      },
      {
        title: 'MLOps deployment',
        summary: 'Package models and wire inference endpoints',
        share: 0.2,
      },
      {
        title: 'Experiment tracking',
        summary: 'Document experiments and share results with stakeholders',
        share: 0.15,
      },
    ],
  },
  FE: {
    skills: ['react', 'typescript', 'css', 'frontend', 'vite', 'accessibility'],
    duties: [
      {
        title: 'UI component development',
        summary: 'Implement reusable React components from designs',
        share: 0.4,
      },
      {
        title: 'API integration (frontend)',
        summary: 'Wire UI to backend APIs and handle state',
        share: 0.25,
      },
      {
        title: 'Cross-browser QA support',
        summary: 'Fix layout and behaviour issues across browsers',
        share: 0.2,
      },
      {
        title: 'Performance tuning',
        summary: 'Optimize bundle size and render performance',
        share: 0.15,
      },
    ],
  },
  QA: {
    skills: ['test-automation', 'selenium', 'api-testing', 'regression-testing', 'jira'],
    duties: [
      {
        title: 'Test case design',
        summary: 'Author functional and regression test cases',
        share: 0.3,
      },
      {
        title: 'Automated test suite',
        summary: 'Maintain API and UI automation scripts',
        share: 0.35,
      },
      {
        title: 'Release regression',
        summary: 'Execute regression cycles before release',
        share: 0.2,
      },
      { title: 'Defect triage', summary: 'Log, reproduce, and verify fixed defects', share: 0.15 },
    ],
  },
  DevOps: {
    skills: ['kubernetes', 'terraform', 'ci-cd', 'aws', 'monitoring', 'docker'],
    duties: [
      {
        title: 'CI/CD pipeline maintenance',
        summary: 'Keep build and deploy pipelines green',
        share: 0.3,
      },
      {
        title: 'Infrastructure as code',
        summary: 'Manage Terraform modules and environment drift',
        share: 0.3,
      },
      {
        title: 'Observability & alerting',
        summary: 'Configure dashboards and on-call alerts',
        share: 0.2,
      },
      {
        title: 'Environment provisioning',
        summary: 'Spin up and tear down non-prod environments',
        share: 0.2,
      },
    ],
  },
  BA: {
    skills: ['requirements', 'user-stories', 'process-modelling', 'stakeholder-mgmt', 'confluence'],
    duties: [
      {
        title: 'Requirements elicitation',
        summary: 'Facilitate workshops and capture business needs',
        share: 0.35,
      },
      {
        title: 'User story authoring',
        summary: 'Write acceptance criteria for delivery teams',
        share: 0.3,
      },
      { title: 'Process mapping', summary: 'Document as-is and to-be process flows', share: 0.2 },
      {
        title: 'UAT coordination',
        summary: 'Support user acceptance testing and sign-off',
        share: 0.15,
      },
    ],
  },
  Design: {
    skills: ['figma', 'ux-research', 'ui-design', 'prototyping', 'design-system'],
    duties: [
      {
        title: 'UX research & wireframes',
        summary: 'Run discovery and produce low-fi wireframes',
        share: 0.3,
      },
      {
        title: 'High-fidelity UI design',
        summary: 'Deliver pixel-ready screens in Figma',
        share: 0.35,
      },
      {
        title: 'Design system contribution',
        summary: 'Extend shared component library',
        share: 0.2,
      },
      {
        title: 'Design QA with engineering',
        summary: 'Review implemented UI against specs',
        share: 0.15,
      },
    ],
  },
  Sec: {
    skills: ['security-audit', 'owasp', 'penetration-testing', 'compliance', 'iam'],
    duties: [
      {
        title: 'Security review',
        summary: 'Review designs and code for security risks',
        share: 0.35,
      },
      {
        title: 'Vulnerability remediation',
        summary: 'Track and verify fixes for findings',
        share: 0.3,
      },
      {
        title: 'Compliance evidence',
        summary: 'Collect audit evidence for control frameworks',
        share: 0.2,
      },
      {
        title: 'Threat modelling',
        summary: 'Facilitate STRIDE sessions for new features',
        share: 0.15,
      },
    ],
  },
};

const DEPARTMENT_SKILLS: Record<string, string[]> = {
  Backend: ['backend', 'api-design'],
  Data: ['data-engineering', 'analytics'],
  'AI/ML': ['machine-learning', 'data-science'],
  Frontend: ['frontend', 'spa'],
  Platform: ['platform-engineering', 'sre'],
  Security: ['appsec', 'risk-management'],
  Design: ['product-design', 'user-experience'],
  BA: ['business-analysis', 'domain-modelling'],
  QA: ['quality-assurance', 'test-planning'],
  PMO: ['project-management', 'resource-planning'],
  Engineering: ['people-management', 'delivery-leadership'],
};

const PROJECT_DOMAIN_SKILLS: Record<string, string[]> = {
  'Software/Migration': ['legacy-migration', 'core-banking'],
  'AI/ML Platform': ['data-platform', 'ml-platform'],
  Software: ['web-application', 'product-delivery'],
  Integration: ['api-integration', 'middleware'],
  Data: ['data-engineering', 'reporting'],
  Mobile: ['mobile-app', 'ios-android'],
};

const TITLE_SKILLS: Array<{ pattern: RegExp; skills: string[] }> = [
  { pattern: /lead|manager/i, skills: ['technical-leadership', 'mentoring'] },
  { pattern: /senior|l[5-6]/i, skills: ['architecture', 'cross-team-coordination'] },
];

const DEFAULT_ROLE_PROFILE: RoleProfile = ROLE_PROFILES.BE ?? {
  skills: [],
  duties: [],
};

function roleProfile(role: string): RoleProfile {
  return ROLE_PROFILES[normalizeRole(role)] ?? DEFAULT_ROLE_PROFILE;
}

function normalizeRole(role: string | null | undefined): string {
  if (!role) return 'BE';
  const r = role.trim();
  if (ROLE_PROFILES[r]) return r;
  const upper = r.toUpperCase();
  if (ROLE_PROFILES[upper]) return upper;
  return r;
}

export type PlannerTaskStatus = 'todo' | 'in progress' | 'done';

export function dutyIndexForRoleTitle(role: string, taskTitle: string): number {
  const profile = ROLE_PROFILES[normalizeRole(role)];
  if (!profile) return 999;
  const index = profile.duties.findIndex((duty) => duty.title === taskTitle);
  return index >= 0 ? index : 999;
}

/** Spread todo / in progress / done across delivery duties for a member-project board. */
export function distributePlannerTaskStatuses(
  taskCount: number,
  hasActiveAllocation: boolean,
): PlannerTaskStatus[] {
  if (taskCount <= 0) return [];
  if (!hasActiveAllocation) return Array.from({ length: taskCount }, () => 'done');
  if (taskCount === 1) return ['in progress'];
  if (taskCount === 2) return ['done', 'in progress'];

  const statuses: PlannerTaskStatus[] = Array.from({ length: taskCount }, () => 'todo');
  const doneCount = Math.max(1, Math.min(taskCount - 2, Math.floor(taskCount * 0.45)));
  for (let index = 0; index < doneCount; index++) statuses[index] = 'done';
  statuses[doneCount] = 'in progress';
  return statuses;
}

export function resolvePlannerTaskStatusesForEntries<
  T extends { allocation_role: string; task_title: string },
>(entries: T[], hasActiveAllocation: boolean): PlannerTaskStatus[] {
  const orderedIndexes = [...entries.keys()]
    .map((index) => {
      const entry = entries[index];
      return {
        index,
        dutyIndex: dutyIndexForRoleTitle(entry?.allocation_role ?? '', entry?.task_title ?? ''),
      };
    })
    .sort((left, right) => left.dutyIndex - right.dutyIndex || left.index - right.index)
    .map((item) => item.index);
  const distribution = distributePlannerTaskStatuses(entries.length, hasActiveAllocation);
  const statuses: PlannerTaskStatus[] = Array.from({ length: entries.length }, () => 'todo');
  for (const [orderedIndex, originalIndex] of orderedIndexes.entries()) {
    statuses[originalIndex] = distribution[orderedIndex] ?? 'todo';
  }
  return statuses;
}

function domainSkills(projectType: string | null | undefined): string[] {
  if (!projectType) return [];
  for (const [key, skills] of Object.entries(PROJECT_DOMAIN_SKILLS)) {
    if (projectType.toLowerCase().includes(key.toLowerCase())) return skills;
  }
  return ['general-delivery'];
}

function uniqueSkills(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) {
    for (const s of g) {
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function titleBonusSkills(roleTitle: string | null, level: string | null): string[] {
  const hay = `${roleTitle ?? ''} ${level ?? ''}`;
  const out: string[] = [];
  for (const { pattern, skills } of TITLE_SKILLS) {
    if (pattern.test(hay)) out.push(...skills);
  }
  return out;
}

export function buildMemberSkillsProfiles(input: {
  members: MockMemberRow[];
  allocations: MockAllocationRow[];
}): MemberSkillsProfile[] {
  const rolesByMember = new Map<string, Set<string>>();
  for (const a of input.allocations) {
    const role = normalizeRole(a.role);
    const roles = rolesByMember.get(a.member_id) ?? new Set<string>();
    roles.add(role);
    rolesByMember.set(a.member_id, roles);
  }

  return input.members.map((m) => {
    const allocationRoles = [...(rolesByMember.get(m.member_id) ?? [])].sort();
    const roleSkills = allocationRoles.flatMap((r) => ROLE_PROFILES[r]?.skills ?? []);
    const deptSkills = DEPARTMENT_SKILLS[m.department ?? ''] ?? [];
    const bonus = titleBonusSkills(m.role_title, m.level);
    const skills = uniqueSkills(
      roleSkills,
      deptSkills,
      bonus,
      allocationRoles.map((r) => r.toLowerCase()),
    );
    const primaryCount = Math.min(6, Math.max(3, roleSkills.length));
    return {
      member_id: m.member_id,
      full_name: m.full_name,
      department: m.department ?? '',
      role_title: m.role_title ?? '',
      level: m.level ?? '',
      allocation_roles: allocationRoles,
      skills,
      primary_skills: skills.slice(0, primaryCount),
    };
  });
}

export function buildMemberTaskHistory(input: {
  members: MockMemberRow[];
  allocations: MockAllocationRow[];
  projects: MockProjectRow[];
  timesheets: MockTimesheetRow[];
}): MemberTaskHistoryEntry[] {
  const projectById = new Map(input.projects.map((p) => [p.project_id, p]));
  const allocRole = new Map<string, string>();
  for (const a of input.allocations) {
    allocRole.set(`${a.member_id}|${a.project_id}`, normalizeRole(a.role));
  }

  const hoursByMemberProject = new Map<string, number>();
  for (const t of input.timesheets) {
    if (t.log_category !== 'Project' || !t.project_id) continue;
    const key = `${t.member_id}|${t.project_id}`;
    hoursByMemberProject.set(key, (hoursByMemberProject.get(key) ?? 0) + t.logged_hours);
  }

  const entries: MemberTaskHistoryEntry[] = [];
  for (const [key, totalHours] of hoursByMemberProject) {
    if (totalHours <= 0) continue;
    const sep = key.indexOf('|');
    if (sep < 0) continue;
    const memberId = key.slice(0, sep);
    const projectId = key.slice(sep + 1);
    const project = projectById.get(projectId);
    if (!project) continue;

    const role = allocRole.get(key) ?? 'BE';
    const profile = roleProfile(role);
    const domain = domainSkills(project.project_type);

    for (const duty of profile.duties) {
      const hours = Math.round(totalHours * duty.share * 10) / 10;
      if (hours < 1) continue;
      entries.push({
        history_id: `${memberId}-${projectId}-${duty.title.replace(/\s+/g, '-').toLowerCase()}`,
        member_id: memberId,
        project_id: projectId,
        project_name: project.project_name,
        project_type: project.project_type ?? '',
        allocation_role: role,
        task_title: duty.title,
        task_summary: duty.summary,
        total_logged_hours: hours,
        skill_tags: uniqueSkills(profile.skills, domain),
      });
    }
  }

  return entries.sort(
    (a, b) => a.member_id.localeCompare(b.member_id) || b.total_logged_hours - a.total_logged_hours,
  );
}

function roleSkillSet(role: string): Set<string> {
  return new Set(roleProfile(role).skills.map((s) => s.toLowerCase()));
}

/**
 * Whether target can perform work in the given RA role (allocation role or prior history).
 */
export function canPerformRole(
  target: MemberSkillsProfile,
  role: string,
  history: MemberTaskHistoryEntry[],
): boolean {
  const normalized = normalizeRole(role);
  if (target.allocation_roles.includes(normalized)) return true;
  return history.some((h) => h.member_id === target.member_id && h.allocation_role === normalized);
}

/**
 * Skill fit for handing off work in a specific RA role (and optionally project).
 */
export function evaluateSkillFit(input: {
  source: MemberSkillsProfile;
  target: MemberSkillsProfile;
  role: string;
  history: MemberTaskHistoryEntry[];
  projectId?: string;
  projectType?: string;
}): SkillFitResult {
  const role = normalizeRole(input.role);
  if (!canPerformRole(input.target, role, input.history)) {
    return {
      score: 0,
      matched_skills: [],
      can_swap: false,
      rationale: `target cannot perform role ${role}`,
    };
  }

  const required = roleSkillSet(role);
  const targetSkills = new Set(input.target.skills.map((s) => s.toLowerCase()));
  const matched = [...required].filter((s) => targetSkills.has(s));
  const targetHistory = input.history.filter((h) => h.member_id === input.target.member_id);
  const sameProject = input.projectId
    ? targetHistory.some((h) => h.project_id === input.projectId)
    : false;
  const projectType = input.projectType;
  const sameDomain =
    projectType != null &&
    projectType.length > 0 &&
    targetHistory.some(
      (h) => h.project_type === projectType || h.project_type.includes(projectType),
    );

  let score = matched.length * 3;
  if (input.target.allocation_roles.includes(role)) score += 12;
  if (sameProject) score += 8;
  else if (sameDomain) score += 4;

  const can_swap =
    matched.length >= MIN_ROLE_SKILL_OVERLAP && input.target.allocation_roles.includes(role);

  const parts: string[] = [];
  parts.push(`${matched.length}/${required.size} role skills`);
  if (input.target.allocation_roles.includes(role)) parts.push(`active ${role} allocation`);
  if (sameProject) parts.push('prior work on same project');
  else if (sameDomain) parts.push('prior work in same domain');

  return {
    score,
    matched_skills: matched,
    can_swap,
    rationale: parts.join('; '),
  };
}

export function buildMemberCapacities(input: {
  members: Array<{ member_id: string; full_name: string; std_hours_week: number | null }>;
  allocations: Array<{ member_id: string; weekly_planned_hours: number | null }>;
  overbookThreshold?: number;
}): MemberCapacity[] {
  const overbookThreshold = input.overbookThreshold ?? 1.1;
  const plannedByMember = new Map<string, number>();
  for (const a of input.allocations) {
    const h = a.weekly_planned_hours ?? 0;
    plannedByMember.set(a.member_id, (plannedByMember.get(a.member_id) ?? 0) + h);
  }

  return input.members.map((m) => {
    const std = m.std_hours_week ?? 40;
    const planned = plannedByMember.get(m.member_id) ?? 0;
    const busy = std > 0 ? planned / std : 0;
    const headroom = Math.max(0, overbookThreshold * std - planned);
    return {
      member_id: m.member_id,
      full_name: m.full_name,
      std_hours_week: std,
      planned_hours: planned,
      busy_rate: busy,
      headroom_hours: headroom,
    };
  });
}

/**
 * Propose concrete member swaps: overbooked → under-utilized peer with same RA role
 * and sufficient skill overlap + capacity headroom.
 */
export function proposeRebalanceSwaps(input: {
  profiles: MemberSkillsProfile[];
  history: MemberTaskHistoryEntry[];
  allocations: Array<{
    member_id: string;
    project_id: string;
    project_name: string;
    project_type: string;
    role: string | null;
    weekly_planned_hours: number | null;
  }>;
  capacities: MemberCapacity[];
  overbookThreshold?: number;
  idleThreshold?: number;
  minTransferHours?: number;
}): MemberSwapProposal[] {
  const overbookThreshold = input.overbookThreshold ?? 1.1;
  const idleThreshold = input.idleThreshold ?? 0.75;
  const minTransferHours = input.minTransferHours ?? 2;

  const profileById = new Map(input.profiles.map((p) => [p.member_id, p]));
  const proposals: MemberSwapProposal[] = [];

  const overloaded = input.capacities.filter((c) => c.busy_rate > overbookThreshold);
  /** Anyone with capacity headroom below the overbook line — not only idle members. */
  const absorbCandidates = input.capacities.filter(
    (c) => c.headroom_hours >= minTransferHours && c.busy_rate < overbookThreshold,
  );

  for (const sourceCap of overloaded) {
    const source = profileById.get(sourceCap.member_id);
    if (!source) continue;

    const excess = Math.max(
      0,
      sourceCap.planned_hours - overbookThreshold * sourceCap.std_hours_week,
    );
    if (excess < minTransferHours) continue;

    const sourceAllocs = input.allocations.filter((a) => a.member_id === sourceCap.member_id);
    let addedForSource = 0;
    for (const alloc of sourceAllocs) {
      const role = normalizeRole(alloc.role);
      const allocHours = alloc.weekly_planned_hours ?? 0;
      if (allocHours <= 0) continue;

      const allocShare = sourceCap.planned_hours > 0 ? allocHours / sourceCap.planned_hours : 0;
      const allocExcess = excess * allocShare;

      for (const targetCap of absorbCandidates) {
        if (targetCap.member_id === sourceCap.member_id) continue;
        if (targetCap.headroom_hours < minTransferHours) continue;

        const target = profileById.get(targetCap.member_id);
        if (!target) continue;

        const fit = evaluateSkillFit({
          source,
          target,
          role,
          history: input.history,
          projectId: alloc.project_id,
          projectType: alloc.project_type,
        });
        if (!fit.can_swap) continue;

        const transferable =
          Math.round(Math.min(allocExcess, targetCap.headroom_hours, allocHours * 0.5) * 10) / 10;
        if (transferable < minTransferHours) continue;

        proposals.push({
          from_member_id: sourceCap.member_id,
          from_member_name: sourceCap.full_name,
          to_member_id: targetCap.member_id,
          to_member_name: targetCap.full_name,
          project_id: alloc.project_id,
          project_name: alloc.project_name,
          role,
          transferable_hours: transferable,
          skill_fit_score: fit.score,
          matched_skills: fit.matched_skills,
          can_swap: true,
          rationale: `Offload ${transferable}h/wk ${role} on ${alloc.project_name}: ${fit.rationale}`,
        });
        addedForSource += 1;
      }
    }

    // When excess is small, per-project slices fall below minTransferHours — propose one block on largest alloc.
    if (addedForSource === 0 && excess >= minTransferHours) {
      const alloc = [...sourceAllocs].sort(
        (a, b) => (b.weekly_planned_hours ?? 0) - (a.weekly_planned_hours ?? 0),
      )[0];
      if (alloc) {
        const role = normalizeRole(alloc.role);
        for (const targetCap of absorbCandidates) {
          if (targetCap.member_id === sourceCap.member_id) continue;
          const target = profileById.get(targetCap.member_id);
          if (!target) continue;
          const fit = evaluateSkillFit({
            source,
            target,
            role,
            history: input.history,
            projectId: alloc.project_id,
            projectType: alloc.project_type,
          });
          if (!fit.can_swap) continue;
          const transferable = Math.round(Math.min(excess, targetCap.headroom_hours) * 10) / 10;
          if (transferable < minTransferHours) continue;
          proposals.push({
            from_member_id: sourceCap.member_id,
            from_member_name: sourceCap.full_name,
            to_member_id: targetCap.member_id,
            to_member_name: targetCap.full_name,
            project_id: alloc.project_id,
            project_name: alloc.project_name,
            role,
            transferable_hours: transferable,
            skill_fit_score: fit.score,
            matched_skills: fit.matched_skills,
            can_swap: true,
            rationale: `Offload ${transferable}h/wk ${role} on ${alloc.project_name}: ${fit.rationale}`,
          });
        }
      }
    }
  }

  // Warm overbook (100%–110%): shift hours to idle peers with same role
  const warmOverbook = input.capacities.filter(
    (c) => c.busy_rate > 1 && c.busy_rate <= overbookThreshold,
  );
  const idlePeers = input.capacities.filter((c) => c.busy_rate < idleThreshold);
  for (const sourceCap of warmOverbook) {
    const source = profileById.get(sourceCap.member_id);
    if (!source) continue;
    const excess = Math.max(0, sourceCap.planned_hours - sourceCap.std_hours_week);
    if (excess < minTransferHours) continue;

    for (const alloc of input.allocations.filter((a) => a.member_id === sourceCap.member_id)) {
      const role = normalizeRole(alloc.role);
      for (const targetCap of idlePeers) {
        const target = profileById.get(targetCap.member_id);
        if (!target) continue;
        const fit = evaluateSkillFit({
          source,
          target,
          role,
          history: input.history,
          projectId: alloc.project_id,
          projectType: alloc.project_type,
        });
        if (!fit.can_swap || targetCap.headroom_hours < minTransferHours) continue;
        const transferable = Math.round(Math.min(excess, targetCap.headroom_hours, 8) * 10) / 10;
        if (transferable < minTransferHours) continue;

        proposals.push({
          from_member_id: sourceCap.member_id,
          from_member_name: sourceCap.full_name,
          to_member_id: targetCap.member_id,
          to_member_name: targetCap.full_name,
          project_id: alloc.project_id,
          project_name: alloc.project_name,
          role,
          transferable_hours: transferable,
          skill_fit_score: fit.score,
          matched_skills: fit.matched_skills,
          can_swap: true,
          rationale: `Rebalance ${transferable}h/wk ${role}: ${fit.rationale}`,
        });
      }
    }
  }

  return proposals.sort(
    (a, b) =>
      b.skill_fit_score - a.skill_fit_score ||
      b.transferable_hours - a.transferable_hours ||
      a.from_member_id.localeCompare(b.from_member_id),
  );
}

/**
 * Rank idle (or under-utilized) members who could absorb work from an overbooked peer.
 * Uses skill overlap on allocation role + project domain history.
 */
export function rankRebalanceCandidates(input: {
  overbookMemberId: string;
  candidateMemberIds: string[];
  profiles: MemberSkillsProfile[];
  history: MemberTaskHistoryEntry[];
  /** Projects the overbooked member is on — prefer candidates with same project history. */
  overbookProjectIds?: string[];
}): RebalanceSuggestCandidate[] {
  const source = input.profiles.find((p) => p.member_id === input.overbookMemberId);
  if (!source) return [];

  const neededSkills = new Set(source.primary_skills);
  const neededRoles = new Set(source.allocation_roles);
  const projectSet = new Set(input.overbookProjectIds ?? []);

  const out: RebalanceSuggestCandidate[] = [];
  for (const id of input.candidateMemberIds) {
    if (id === input.overbookMemberId) continue;
    const profile = input.profiles.find((p) => p.member_id === id);
    if (!profile) continue;

    const matched = profile.skills.filter((s) => neededSkills.has(s));
    const roleOverlap = profile.allocation_roles.filter((r) => neededRoles.has(r));
    const memberHistory = input.history.filter((h) => h.member_id === id);
    const relevantProjects = [
      ...new Set(
        memberHistory
          .filter((h) => projectSet.size === 0 || projectSet.has(h.project_id))
          .map((h) => h.project_name),
      ),
    ];

    let score = matched.length * 2 + roleOverlap.length * 5 + relevantProjects.length * 3;
    if (roleOverlap.length > 0) score += 10;

    const primaryRole = source.allocation_roles[0];
    const fit =
      primaryRole && roleOverlap.length > 0
        ? evaluateSkillFit({
            source,
            target: profile,
            role: primaryRole,
            history: input.history,
            projectId: projectSet.size === 1 ? [...projectSet][0] : undefined,
          })
        : null;
    const can_swap = (fit?.can_swap ?? false) || score >= MIN_SWAP_SCORE;

    const rationaleParts: string[] = [];
    if (roleOverlap.length > 0) rationaleParts.push(`same RA role (${roleOverlap.join(', ')})`);
    if (matched.length > 0) rationaleParts.push(`${matched.length} skill overlap`);
    if (relevantProjects.length > 0)
      rationaleParts.push(`worked on ${relevantProjects.slice(0, 2).join(', ')}`);
    if (!can_swap) rationaleParts.push('insufficient skill/role fit for swap');
    else if (rationaleParts.length === 0) rationaleParts.push('skill fit ok');

    out.push({
      member_id: id,
      full_name: profile.full_name,
      score,
      matched_skills: fit?.matched_skills.length ? fit.matched_skills : matched,
      relevant_projects: relevantProjects,
      can_swap,
      rationale: rationaleParts.join('; '),
    });
  }

  return out.sort((a, b) => b.score - a.score || a.member_id.localeCompare(b.member_id));
}

export function buildMemberSkillsAndHistory(input: {
  members: MockMemberRow[];
  allocations: MockAllocationRow[];
  projects: MockProjectRow[];
  timesheets: MockTimesheetRow[];
}): { profiles: MemberSkillsProfile[]; history: MemberTaskHistoryEntry[] } {
  const profiles = buildMemberSkillsProfiles({
    members: input.members,
    allocations: input.allocations,
  });
  const history = buildMemberTaskHistory(input);
  return { profiles, history };
}
