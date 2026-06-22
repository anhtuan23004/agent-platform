import { useMemo } from 'react';
import type { DemoAnalyticsResult, DemoProjectInput } from '../../api/demo-analytics.ts';
import { filterDemoAnalyticsPopulations } from './use-filtered-data.logic.ts';

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
    if (!memberFilter && !projectFilter) return data;

    const { scopedRosterRows, deliveryMembers, projectManagers, onlyDeliveryMember } =
      filterDemoAnalyticsPopulations(data, memberFilter, projectFilter);
    const onlyProject = (id: string) => (projectFilter ? id === projectFilter : true);

    return {
      ...data,
      populations: {
        deliveryMembers,
        projectManagers,
      },
      projectMemberDependencies: scopedRosterRows,
      memberWeekProjectFacts: data.memberWeekProjectFacts.filter(
        (fact) => onlyDeliveryMember(fact.memberId) && onlyProject(fact.projectId),
      ),
      memberWeekFacts: data.memberWeekFacts.filter((f) => onlyDeliveryMember(f.memberId)),
      memberAnalyses: data.memberAnalyses.filter((a) => onlyDeliveryMember(a.memberId)),
      overbookIdleFindings: data.overbookIdleFindings.filter((f) => onlyDeliveryMember(f.memberId)),
      mismatchFindings: data.mismatchFindings.filter((f) => onlyDeliveryMember(f.memberId)),
    };
  }, [data, memberFilter, projectFilter]);

  return { filtered, members, projects, getMemberLabel, getProjectLabel, projectById };
}
