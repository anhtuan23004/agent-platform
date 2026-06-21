import { and, eq, max, sql } from 'drizzle-orm';
import { pmoDb } from '../../db/client.ts';
import { memberMaster, memberSkillsProjection, taskHistoryProjection } from '../../db/schema.ts';
import { normalizeSkill } from './skill-coverage.ts';

export interface SyncMemberSkillInput {
  tenantId: string;
  memberId: string;
  skillName: string;
  proficiencyLevel?: number | null;
  evidenceConfidence?: number;
  source: string;
  sourceVersion: string;
  idempotencyKey: string;
  observedAt: Date;
  syncedAt?: Date;
}

export interface SyncTaskHistoryInput {
  tenantId: string;
  historyId: string;
  memberId: string;
  projectId?: string | null;
  allocationRole?: string | null;
  taskTitle: string;
  taskSummary?: string | null;
  skillTags?: string[];
  completedAt: Date;
  evidenceConfidence?: number;
  embedding?: number[] | null;
  embeddingModelId?: string | null;
  embeddingSourceHash?: string | null;
  source: string;
  sourceVersion: string;
  idempotencyKey: string;
  syncedAt?: Date;
}

async function requireMemberMapping(tenantId: string, memberId: string): Promise<void> {
  const rows = await pmoDb()
    .select({ memberId: memberMaster.member_id })
    .from(memberMaster)
    .where(
      and(
        eq(memberMaster.tenant_id, tenantId),
        eq(memberMaster.member_id, memberId),
        eq(memberMaster.is_active, true),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new Error(`recommendation_member_mapping_missing:${memberId}`);
}

export async function syncMemberSkillProjection(input: SyncMemberSkillInput): Promise<void> {
  await requireMemberMapping(input.tenantId, input.memberId);
  const now = input.syncedAt ?? new Date();
  const skillKey = normalizeSkill(input.skillName);
  await pmoDb()
    .insert(memberSkillsProjection)
    .values({
      tenant_id: input.tenantId,
      member_id: input.memberId,
      skill_key: skillKey,
      skill_name: input.skillName.trim(),
      proficiency_level: input.proficiencyLevel ?? null,
      evidence_confidence: input.evidenceConfidence ?? 1,
      source: input.source,
      source_version: input.sourceVersion,
      idempotency_key: input.idempotencyKey,
      observed_at: input.observedAt,
      synced_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [memberSkillsProjection.tenant_id, memberSkillsProjection.idempotency_key],
      set: {
        member_id: input.memberId,
        skill_key: skillKey,
        skill_name: input.skillName.trim(),
        proficiency_level: input.proficiencyLevel ?? null,
        evidence_confidence: input.evidenceConfidence ?? 1,
        source: input.source,
        source_version: input.sourceVersion,
        observed_at: input.observedAt,
        synced_at: now,
        is_active: true,
        updated_at: now,
      },
    });
}

export async function syncTaskHistoryProjection(input: SyncTaskHistoryInput): Promise<void> {
  await requireMemberMapping(input.tenantId, input.memberId);
  const now = input.syncedAt ?? new Date();
  const values = {
    member_id: input.memberId,
    project_id: input.projectId ?? null,
    allocation_role: input.allocationRole ?? null,
    task_title: input.taskTitle,
    task_summary: input.taskSummary ?? null,
    skill_tags: [...new Set((input.skillTags ?? []).map(normalizeSkill))].sort(),
    completed_at: input.completedAt,
    evidence_confidence: input.evidenceConfidence ?? 1,
    embedding: input.embedding ?? null,
    embedding_model_id: input.embeddingModelId ?? null,
    embedding_source_hash: input.embeddingSourceHash ?? null,
    source: input.source,
    source_version: input.sourceVersion,
    synced_at: now,
    is_active: true,
    updated_at: now,
  };
  await pmoDb()
    .insert(taskHistoryProjection)
    .values({
      tenant_id: input.tenantId,
      history_id: input.historyId,
      idempotency_key: input.idempotencyKey,
      ...values,
    })
    .onConflictDoUpdate({
      target: [taskHistoryProjection.tenant_id, taskHistoryProjection.idempotency_key],
      set: { history_id: input.historyId, ...values },
    });
}

export async function getRecommendationProjectionFreshness(tenantId: string): Promise<{
  skillCount: number;
  taskCount: number;
  latestSkillSyncAt: Date | null;
  latestTaskSyncAt: Date | null;
}> {
  const db = pmoDb();
  const [skills, tasks] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int`, latest: max(memberSkillsProjection.synced_at) })
      .from(memberSkillsProjection)
      .where(
        and(
          eq(memberSkillsProjection.tenant_id, tenantId),
          eq(memberSkillsProjection.is_active, true),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int`, latest: max(taskHistoryProjection.synced_at) })
      .from(taskHistoryProjection)
      .where(
        and(
          eq(taskHistoryProjection.tenant_id, tenantId),
          eq(taskHistoryProjection.is_active, true),
        ),
      ),
  ]);
  return {
    skillCount: skills[0]?.count ?? 0,
    taskCount: tasks[0]?.count ?? 0,
    latestSkillSyncAt: skills[0]?.latest ?? null,
    latestTaskSyncAt: tasks[0]?.latest ?? null,
  };
}
