import { and, eq, gte, lte } from 'drizzle-orm';
import type { ReportEvidence } from '../../analytics/load-report-evidence.ts';
import { pmoDb } from '../../db/client.ts';
import { memberSkillsProjection, taskHistoryProjection } from '../../db/schema.ts';
import type { RebalanceEvidence } from './contracts.ts';

export async function loadRecommendationEvidence(input: {
  tenantId: string;
  from: Date;
  to: Date;
  reportEvidence: ReportEvidence;
  historyWindowDays: number;
}): Promise<RebalanceEvidence> {
  const db = pmoDb();
  const historyFrom = new Date(input.to);
  historyFrom.setUTCDate(historyFrom.getUTCDate() - input.historyWindowDays);
  const [skills, tasks] = await Promise.all([
    db
      .select()
      .from(memberSkillsProjection)
      .where(
        and(
          eq(memberSkillsProjection.tenant_id, input.tenantId),
          eq(memberSkillsProjection.is_active, true),
          lte(memberSkillsProjection.observed_at, input.to),
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
          lte(taskHistoryProjection.completed_at, input.to),
        ),
      ),
  ]);
  return {
    facts: input.reportEvidence.facts,
    weeks: [...input.reportEvidence.ctx.weeksById.values()],
    allocations: input.reportEvidence.allocations ?? [],
    members: (input.reportEvidence.members ?? []).map((member) => ({
      memberId: member.memberId,
      department: member.department,
      roleTitle: member.roleTitle,
    })),
    skills: skills.map((skill) => ({
      memberId: skill.member_id,
      skillKey: skill.skill_key,
      proficiencyLevel: skill.proficiency_level,
      evidenceConfidence: skill.evidence_confidence,
      sourceVersion: skill.source_version,
    })),
    taskHistory: tasks.map((task) => ({
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
