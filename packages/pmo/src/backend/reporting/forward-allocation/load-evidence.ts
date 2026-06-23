import { and, eq, gte, lte } from 'drizzle-orm';
import type { ReportEvidence } from '../../analytics/load-report-evidence.ts';
import { loadReportEvidence } from '../../analytics/load-report-evidence.ts';
import { pmoDb } from '../../db/client.ts';
import { memberSkillsProjection, taskHistoryProjection } from '../../db/schema.ts';
import type {
  ForwardAllocationDemandWindow,
  ForwardAllocationEvidence,
  ForwardAllocationRiskSummary,
} from './contracts.ts';
import { buildProjectDemandGapWindows } from './demand.ts';
import { loadProjectDemandPlan } from './load-demand-plan.ts';
import { buildForwardAllocationWindow } from './window.ts';

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function toDemandWindow(input: {
  row: Awaited<ReturnType<typeof loadProjectDemandPlan>>[number];
}): ForwardAllocationDemandWindow {
  return {
    demandId: input.row.demandId,
    projectId: input.row.projectId,
    roleNeeded: input.row.roleNeeded,
    requiredSkills: input.row.requiredSkills,
    demandStart: input.row.demandStart,
    demandEnd: input.row.demandEnd,
    demandPct: input.row.demandPct,
    demandHoursPerWeek: input.row.demandHoursPerWeek,
    urgency: input.row.urgency,
    priorityScore: input.row.priorityScore,
    confirmed: input.row.confirmed,
    demandSource: input.row.demandSource,
    note: input.row.note,
    evidenceFlags: input.row.confirmed ? [] : ['requires_demand_confirmation'],
  };
}

function buildModeSummary(demandWindows: ForwardAllocationDemandWindow[]) {
  const demandBackedCount = demandWindows.filter((row) => row.confirmed).length;
  return {
    demandBackedCount,
    inferredCount: demandWindows.length - demandBackedCount,
  };
}

function buildRiskByMember(
  facts: ForwardAllocationEvidence['facts'],
): Map<string, ForwardAllocationRiskSummary> {
  const buckets = new Map<
    string,
    {
      availableHours: number;
      plannedHours: number;
      loggedHours: number;
      trainingHours: number;
      benchHours: number;
      overtimeHours: number;
    }
  >();

  for (const fact of facts) {
    const current = buckets.get(fact.memberId) ?? {
      availableHours: 0,
      plannedHours: 0,
      loggedHours: 0,
      trainingHours: 0,
      benchHours: 0,
      overtimeHours: 0,
    };
    current.availableHours += fact.availableHours;
    current.plannedHours += fact.plannedHours;
    current.loggedHours += fact.loggedHours;
    current.trainingHours += fact.trainingHours;
    current.benchHours += fact.benchHours;
    current.overtimeHours += fact.overtimeHours;
    buckets.set(fact.memberId, current);
  }

  return new Map(
    [...buckets.entries()].map(([memberId, bucket]) => {
      const availableHours = bucket.availableHours;
      const plannedHours = bucket.plannedHours;
      const loggedHours = bucket.loggedHours;
      return [
        memberId,
        {
          memberId,
          availableHours,
          plannedHours,
          loggedHours,
          utilization: availableHours > 0 ? round4(loggedHours / availableHours) : null,
          effortConsumption: plannedHours > 0 ? round4(loggedHours / plannedHours) : null,
          overtimeRatio: availableHours > 0 ? round4(bucket.overtimeHours / availableHours) : null,
          trainingHours: bucket.trainingHours,
          benchHours: bucket.benchHours,
        },
      ];
    }),
  );
}

export async function loadForwardAllocationEvidence(input: {
  tenantId: string;
  evidenceFrom: Date;
  evidenceTo: Date;
  planningStart?: Date;
  planningEnd?: Date;
  horizonWeeks?: number;
  historyWindowDays?: number;
  reportEvidence?: ReportEvidence;
}): Promise<ForwardAllocationEvidence> {
  const reportEvidence =
    input.reportEvidence ??
    (await loadReportEvidence(input.tenantId, {
      dateRange: { from: input.evidenceFrom, to: input.evidenceTo },
    }));

  const window = buildForwardAllocationWindow({
    evidenceFrom: input.evidenceFrom,
    evidenceTo: input.evidenceTo,
    planningStart: input.planningStart,
    planningEnd: input.planningEnd,
    horizonWeeks: input.horizonWeeks ?? 8,
  });

  const db = pmoDb();
  const historyWindowDays =
    input.historyWindowDays ?? reportEvidence.reportRules?.recommendation.historyWindowDays ?? 180;
  const historyFrom = new Date(window.evidenceTo);
  historyFrom.setUTCDate(historyFrom.getUTCDate() - historyWindowDays);

  const [skills, taskHistory, rawDemandWindows] = await Promise.all([
    db
      .select()
      .from(memberSkillsProjection)
      .where(
        and(
          eq(memberSkillsProjection.tenant_id, input.tenantId),
          eq(memberSkillsProjection.is_active, true),
          lte(memberSkillsProjection.observed_at, window.evidenceTo),
        ),
      ),
    db
      .select()
      .from(taskHistoryProjection)
      .where(
        and(
          eq(taskHistoryProjection.tenant_id, input.tenantId),
          eq(taskHistoryProjection.is_active, true),
          gte(taskHistoryProjection.completed_at, historyFrom),
          lte(taskHistoryProjection.completed_at, window.evidenceTo),
        ),
      ),
    loadProjectDemandPlan({
      tenantId: input.tenantId,
      from: window.planningStart,
      to: window.planningEnd,
    }),
  ]);

  const demandWindows = rawDemandWindows.map((row) => toDemandWindow({ row }));
  const riskByMember = buildRiskByMember(reportEvidence.facts);
  const demandGaps = buildProjectDemandGapWindows({
    projects: (reportEvidence.projects ?? []).map((project) => ({
      project_id: project.project_id,
      project_name: project.project_name,
      account_id: project.account_id,
      project_type: project.project_type,
      status: project.status,
      pm_id: project.pm_id,
      start_date: project.start_date,
      end_date: project.end_date,
    })),
    allocations: reportEvidence.allocations ?? [],
    demandWindows,
    planningWindow: { from: window.planningStart, to: window.planningEnd },
  });

  return {
    window,
    modeSummary: buildModeSummary(demandWindows),
    facts: reportEvidence.facts,
    weeks: [...reportEvidence.ctx.weeksById.values()],
    leaves: reportEvidence.ctx.leaves,
    allocations: reportEvidence.allocations ?? [],
    members: reportEvidence.members ?? [],
    projects: reportEvidence.projects ?? [],
    demandWindows,
    demandGaps,
    riskByMember,
    skills: skills.map((skill) => ({
      memberId: skill.member_id,
      skillKey: skill.skill_key,
      proficiencyLevel: skill.proficiency_level,
      evidenceConfidence: skill.evidence_confidence,
      sourceVersion: skill.source_version,
    })),
    taskHistory: taskHistory.map((task) => ({
      historyId: task.history_id,
      memberId: task.member_id,
      projectId: task.project_id,
      allocationRole: task.allocation_role,
      taskTitle: task.task_title,
      taskSummary: task.task_summary,
      skillTags: task.skill_tags,
      completedAt: task.completed_at,
      evidenceConfidence: task.evidence_confidence,
      embedding: task.embedding,
      embeddingModelId: task.embedding_model_id,
      embeddingSourceHash: task.embedding_source_hash,
      sourceVersion: task.source_version,
    })),
  };
}
