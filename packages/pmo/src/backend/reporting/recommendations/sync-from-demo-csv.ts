import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import {
  DEMO_EMBEDDING_MODEL_ID,
  deterministicEmbeddingFromHash,
} from '../../demo/demo-embeddings.ts';
import { syncMemberSkillProjection, syncTaskHistoryProjection } from './sync-projections.ts';

function findAncestorWith(startDir: string, markerPath: string): string | null {
  let current = startDir;
  while (true) {
    if (existsSync(resolve(current, markerPath))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolvePmoSeedAssetRoot(): string {
  if (process.env.PMO_SEED_ASSET_ROOT) return process.env.PMO_SEED_ASSET_ROOT;
  if (process.env.APP_HOME) return resolve(process.env.APP_HOME, 'apps/cli');

  const currentDir = fileURLToPath(new URL('.', import.meta.url));
  const monorepoRoot = findAncestorWith(currentDir, 'pnpm-workspace.yaml');
  if (monorepoRoot) return monorepoRoot;

  const assetRoot = findAncestorWith(currentDir, 'hackathon/data');
  if (assetRoot) return assetRoot;

  return resolve(currentDir, '../../../../..');
}

function readSeedCsv<T extends Record<string, string>>(filename: string): T[] {
  const filePath = resolve(resolvePmoSeedAssetRoot(), 'hackathon/data', filename);
  if (!existsSync(filePath)) return [];
  return parse(readFileSync(filePath, 'utf8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as T[];
}

function optionalNumber(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requiredDate(field: string, value: string | undefined): Date {
  const date = parseDate(value);
  if (!date) throw new Error(`Invalid required PMO recommendation seed date for ${field}`);
  return date;
}

function isMissingMemberMapping(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith('recommendation_member_mapping_missing:')
  );
}

export async function syncRecommendationProjectionsFromDemoCsv(input: {
  tenantId: string;
}): Promise<{ skills: number; taskHistory: number }> {
  const skillRows = readSeedCsv<{
    member_id: string;
    skill: string;
    proficiency_level: string;
    evidence_confidence: string;
    source: string;
    observed_at: string;
    updated_at: string;
    source_version: string;
  }>('pmo_02_member_skills.csv');
  const historyRows = readSeedCsv<{
    history_id: string;
    member_id: string;
    project_id: string;
    allocation_role: string;
    task_title: string;
    task_summary: string;
    skill_tags: string;
    completed_at: string;
    evidence_confidence: string;
    source: string;
    synced_at: string;
    source_version: string;
    embedding_source_hash: string;
  }>('pmo_02_member_task_history.csv');
  let skills = 0;
  let taskHistory = 0;

  for (const row of skillRows) {
    try {
      await syncMemberSkillProjection({
        tenantId: input.tenantId,
        memberId: row.member_id,
        skillName: row.skill,
        proficiencyLevel: optionalNumber(row.proficiency_level),
        evidenceConfidence: optionalNumber(row.evidence_confidence) ?? 1,
        source: row.source || 'derived_pmo02',
        sourceVersion: row.source_version || 'pmo02-recommendation-mock-v1',
        idempotencyKey: `pmo02:skill:${row.member_id}:${row.skill}`,
        observedAt: requiredDate('member_skills.observed_at', row.observed_at),
        syncedAt: parseDate(row.updated_at) ?? undefined,
      });
      skills++;
    } catch (error) {
      if (!isMissingMemberMapping(error)) throw error;
    }
  }

  for (const row of historyRows) {
    try {
      const embeddingHash = row.embedding_source_hash?.trim() || '';
      const embeddingVector = embeddingHash ? deterministicEmbeddingFromHash(embeddingHash) : null;
      await syncTaskHistoryProjection({
        tenantId: input.tenantId,
        historyId: row.history_id,
        memberId: row.member_id,
        projectId: row.project_id || null,
        allocationRole: row.allocation_role || null,
        taskTitle: row.task_title,
        taskSummary: row.task_summary || null,
        skillTags: row.skill_tags ? row.skill_tags.split('|').filter(Boolean) : [],
        completedAt: requiredDate('task_history.completed_at', row.completed_at),
        evidenceConfidence: optionalNumber(row.evidence_confidence) ?? 1,
        embedding: embeddingVector,
        embeddingModelId: embeddingVector ? DEMO_EMBEDDING_MODEL_ID : null,
        embeddingSourceHash: embeddingHash || null,
        source: row.source || 'derived_pmo02',
        sourceVersion: row.source_version || 'pmo02-recommendation-mock-v1',
        idempotencyKey: `pmo02:history:${row.history_id}`,
        syncedAt: parseDate(row.synced_at) ?? undefined,
      });
      taskHistory++;
    } catch (error) {
      if (!isMissingMemberMapping(error)) throw error;
    }
  }

  return { skills, taskHistory };
}
