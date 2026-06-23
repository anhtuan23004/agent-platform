import type { DemoAnalyticsResult } from '../../api/demo-analytics.ts';

export function filterDemoAnalyticsPopulations(
  data: DemoAnalyticsResult,
  memberFilter: string | null,
  projectFilter: string | null,
) {
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

  return {
    scopedRosterRows,
    deliveryMembers: data.populations.deliveryMembers.filter((m) => onlyDeliveryMember(m.memberId)),
    projectManagers: data.populations.projectManagers.filter((m) =>
      onlyPopulationMember(m.memberId),
    ),
    onlyDeliveryMember,
  };
}
