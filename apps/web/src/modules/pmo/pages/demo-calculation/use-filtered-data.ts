import { useMemo } from 'react';
import type { DemoAnalyticsResult, DemoProjectInput } from '../../api/demo-analytics.ts';

export function useFilteredDemoAnalytics(
  data: DemoAnalyticsResult | undefined,
  memberFilter: string | null,
  projectFilter: string | null,
) {
  const members = useMemo(() => {
    const rows = data?.canonical.members ?? [];
    return [...new Set(rows.map((m) => m.memberId))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const projects = useMemo(() => {
    const rows = data?.canonical.projects ?? [];
    return [...new Set(rows.map((p) => p.projectId))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const projectById = useMemo(() => {
    const map = new Map<string, DemoProjectInput>();
    for (const p of data?.canonical.projects ?? []) map.set(p.projectId, p);
    return map;
  }, [data]);

  const memberById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of data?.canonical.members ?? []) {
      map.set(m.memberId, m.fullName?.trim() || m.memberId);
    }
    return map;
  }, [data]);

  const getMemberLabel = (id: string) => memberById.get(id) ?? id;
  const getProjectLabel = (id: string) => projectById.get(id)?.projectName?.trim() || id;

  const filtered = useMemo(() => {
    if (!data) return null;

    const onlyProject = (id: string) => (projectFilter ? id === projectFilter : true);
    const scopedRosterRows = data.projectMemberDependencies.filter(
      (row) => (!memberFilter || row.memberId === memberFilter) && onlyProject(row.projectId),
    );
    const projectMemberIds = new Set(scopedRosterRows.map((r) => r.memberId));
    const rosterPmIds = new Set(
      scopedRosterRows.map((r) => r.pmId).filter((id): id is string => Boolean(id)),
    );
    const projectPmIds = new Set(
      data.canonical.projects
        .filter((p) => onlyProject(p.projectId))
        .map((p) => p.pmId)
        .filter((id): id is string => Boolean(id)),
    );

    const onlyDeliveryMember = (id: string) => {
      if (memberFilter) return id === memberFilter;
      if (projectFilter) return projectMemberIds.has(id);
      return true;
    };

    const onlyPopulationMember = (id: string) => {
      if (memberFilter) return id === memberFilter || rosterPmIds.has(id);
      if (projectFilter) return projectMemberIds.has(id) || projectPmIds.has(id);
      return true;
    };

    if (!memberFilter && !projectFilter) return data;

    return {
      ...data,
      populations: {
        deliveryMembers: data.populations.deliveryMembers.filter((m) =>
          onlyDeliveryMember(m.memberId),
        ),
        projectManagers: data.populations.projectManagers.filter((m) =>
          onlyPopulationMember(m.memberId),
        ),
      },
      projectMemberDependencies: scopedRosterRows,
      memberWeekFacts: data.memberWeekFacts.filter((f) => onlyDeliveryMember(f.memberId)),
      memberAnalyses: data.memberAnalyses.filter((a) => onlyDeliveryMember(a.memberId)),
      overbookIdleFindings: data.overbookIdleFindings.filter((f) => onlyDeliveryMember(f.memberId)),
      mismatchFindings: data.mismatchFindings.filter((f) => onlyDeliveryMember(f.memberId)),
    };
  }, [data, memberFilter, projectFilter]);

  return { filtered, members, projects, getMemberLabel, getProjectLabel, projectById };
}
