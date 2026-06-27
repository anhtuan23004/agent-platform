/**
 * Deterministically enrich PMO recommendation mock CSVs with projection metadata.
 *
 * Dates are bounded by the workbook test range 2026-06-29..2026-08-07.
 * This script only updates the three recommendation source fixtures; it does not
 * regenerate the workbook-derived data or pmo_02_rebalance_swaps.csv.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  type RebalanceSwapRow,
  type RecommendationHistoryRow,
  tuneRecommendationHistoryRows,
} from '../src/backend/demo/tune-recommendation-history.ts';

const DATA_DIR = resolve(import.meta.dirname, '../../../hackathon/data');
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const RANGE_START = new Date('2026-06-29T00:00:00.000Z');
const RANGE_DAYS = 40;
const RANGE_END = '2026-08-07';
const SOURCE_VERSION = 'pmo02-recommendation-mock-v1';

type CsvRow = Record<string, string>;

function readCsv(filename: string): CsvRow[] {
  return parse(readFileSync(resolve(DATA_DIR, filename), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRow[];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filename: string, headers: string[], rows: CsvRow[]): void {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','));
  writeFileSync(resolve(DATA_DIR, filename), `${lines.join('\n')}\n`, 'utf8');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function dateForHistory(historyId: string): string {
  const offset = Number.parseInt(hash(historyId).slice(0, 8), 16) % RANGE_DAYS;
  const date = new Date(RANGE_START);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function numericLevel(level: string): number {
  const parsed = Number.parseInt(level.replace(/^L/i, ''), 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 3;
}

function managerFor(memberId: string, department: string): string {
  if (memberId === 'EMP-011') return '';
  if (department === 'PMO' && memberId !== 'EMP-012') return 'EMP-012';
  return 'EMP-011';
}

const profiles = readCsv('pmo_02_member_profiles.csv').map((row) => ({
  tenant_id: TENANT_ID,
  ...row,
  employment_status: 'active',
  std_hours_week: '40',
  join_date: '2024-01-01',
  line_manager_id: managerFor(row.member_id ?? '', row.department ?? ''),
  is_active: 'true',
  source: 'derived_pmo02',
  synced_at: `${RANGE_END}T23:59:59.000Z`,
  source_version: SOURCE_VERSION,
}));

writeCsv(
  'pmo_02_member_profiles.csv',
  [
    'tenant_id',
    'member_id',
    'full_name',
    'department',
    'role_title',
    'level',
    'allocation_roles',
    'primary_skills',
    'skills',
    'employment_status',
    'std_hours_week',
    'join_date',
    'line_manager_id',
    'is_active',
    'source',
    'synced_at',
    'source_version',
  ],
  profiles,
);

const profileLevel = new Map(profiles.map((row) => [row.member_id ?? '', row.level ?? 'L3']));
const skills = readCsv('pmo_02_member_skills.csv').map((row) => {
  const primary = row.is_primary === 'true';
  const level = numericLevel(profileLevel.get(row.member_id ?? '') ?? 'L3');
  return {
    tenant_id: TENANT_ID,
    member_id: row.member_id ?? '',
    skill: row.skill ?? '',
    proficiency_level: String(primary ? Math.max(3, level) : Math.max(1, level - 1)),
    is_primary: row.is_primary ?? 'false',
    evidence_confidence: primary ? '0.95' : '0.8',
    source: row.source || 'derived_pmo02',
    observed_at: '2026-06-29T00:00:00.000Z',
    updated_at: `${RANGE_END}T23:59:59.000Z`,
    source_version: SOURCE_VERSION,
  };
});

writeCsv(
  'pmo_02_member_skills.csv',
  [
    'tenant_id',
    'member_id',
    'skill',
    'proficiency_level',
    'is_primary',
    'evidence_confidence',
    'source',
    'observed_at',
    'updated_at',
    'source_version',
  ],
  skills,
);

const historyBase = readCsv('pmo_02_member_task_history.csv') as RecommendationHistoryRow[];
const swaps = readCsv('pmo_02_rebalance_swaps.csv') as RebalanceSwapRow[];
const tunedHistory = tuneRecommendationHistoryRows({
  rows: historyBase,
  swaps,
  fallbackCompletedAt: dateForHistory,
});

const history = tunedHistory.map((row) => {
  const evidenceConfidence = Number(row.total_logged_hours ?? 0) >= 20 ? '0.9' : '0.75';
  const embeddingText =
    row.embedding_text ??
    [row.task_title, row.task_summary, row.skill_tags].filter(Boolean).join(' | ');
  const embeddingSourceHash =
    row.embedding_source_hash ?? (embeddingText ? hash(embeddingText) : '');
  return {
    tenant_id: TENANT_ID,
    ...row,
    completed_at: row.completed_at ?? `${dateForHistory(row.history_id ?? '')}T17:00:00.000Z`,
    evidence_confidence: evidenceConfidence,
    source: 'derived_pmo02',
    synced_at: `${RANGE_END}T23:59:59.000Z`,
    source_version: SOURCE_VERSION,
    embedding_text: embeddingText,
    embedding_source_hash: embeddingSourceHash,
  };
});

writeCsv(
  'pmo_02_member_task_history.csv',
  [
    'tenant_id',
    'history_id',
    'member_id',
    'project_id',
    'project_name',
    'project_type',
    'allocation_role',
    'task_title',
    'task_summary',
    'total_logged_hours',
    'skill_tags',
    'completed_at',
    'evidence_confidence',
    'source',
    'synced_at',
    'source_version',
    'embedding_text',
    'embedding_source_hash',
  ],
  history,
);

console.log(
  `enriched profiles=${profiles.length} skills=${skills.length} history=${history.length} range=2026-06-29..${RANGE_END}`,
);
