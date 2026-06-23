import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { pmoDb } from '../db/client.ts';
import type * as schema from '../db/schema.ts';
import { overbookIdleConfig } from '../db/schema.ts';
import { computeNaturalKeyHash, computeSourceRowHash } from '../ingestion/stage-changes.ts';

const DefaultThresholdConfigSchema = z.object({
  config_id: z.string().min(1),
  rule_name: z.string().min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  overbook_threshold: z.number().min(0),
  overbook_red_threshold: z.number().min(0).nullable().optional(),
  idle_threshold: z.number().min(0),
  mismatch_pct_threshold: z.number().min(0).nullable().optional(),
  ot_max_hours_per_week: z.number().min(0).nullable().optional(),
  required_training_hours: z.number().min(0).nullable().optional(),
});

const DefaultThresholdConfigsSchema = z.array(DefaultThresholdConfigSchema).min(1);

export type DefaultThresholdConfig = z.infer<typeof DefaultThresholdConfigSchema>;

const DEFAULT_CONFIG_PATH = resolve(
  fileURLToPath(new URL('../../../config/overbook-idle-defaults.json', import.meta.url)),
);

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function loadDefaultThresholdConfigs(
  path: string = DEFAULT_CONFIG_PATH,
): DefaultThresholdConfig[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return DefaultThresholdConfigsSchema.parse(raw);
}

export interface SeedPmoDefaultThresholdConfigsInput {
  tenantId: string;
  ingestionSessionId?: string;
  db?: NodePgDatabase<typeof schema>;
  path?: string;
}

export interface SeedPmoDefaultThresholdConfigsResult {
  tenantId: string;
  inserted: number;
  configIds: string[];
}

export async function seedPmoDefaultThresholdConfigsForTenant(
  input: SeedPmoDefaultThresholdConfigsInput,
): Promise<SeedPmoDefaultThresholdConfigsResult> {
  const tenantId = input.tenantId;
  const ingestionSessionId = input.ingestionSessionId ?? randomUUID();
  const db = input.db ?? pmoDb();
  const configs = loadDefaultThresholdConfigs(input.path);
  const now = new Date();

  const rows = configs.map((config, index) => {
    const values = {
      config_id: config.config_id,
      rule_name: config.rule_name,
      overbook_threshold: config.overbook_threshold,
      overbook_red_threshold: config.overbook_red_threshold ?? null,
      idle_threshold: config.idle_threshold,
      mismatch_pct_threshold: config.mismatch_pct_threshold ?? null,
      ot_max_hours_per_week: config.ot_max_hours_per_week ?? null,
      required_training_hours: config.required_training_hours ?? null,
      effective_date: parseDate(config.effective_date),
    };
    return {
      tenant_id: tenantId,
      natural_key_hash: computeNaturalKeyHash('overbook_idle_config', tenantId, values),
      source_row_hash: computeSourceRowHash('overbook_idle_config', values),
      last_ingestion_session_id: ingestionSessionId,
      is_active: true,
      ...values,
      source_row: index + 1,
      created_at: now,
      updated_at: now,
    };
  });

  if (rows.length === 0) {
    return { tenantId, inserted: 0, configIds: [] };
  }

  await db
    .insert(overbookIdleConfig)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        overbookIdleConfig.tenant_id,
        overbookIdleConfig.last_ingestion_session_id,
        overbookIdleConfig.natural_key_hash,
      ],
      set: {
        source_row_hash: sqlExcluded('source_row_hash'),
        last_ingestion_session_id: sqlExcluded('last_ingestion_session_id'),
        is_active: sqlExcluded('is_active'),
        config_id: sqlExcluded('config_id'),
        rule_name: sqlExcluded('rule_name'),
        overbook_threshold: sqlExcluded('overbook_threshold'),
        overbook_red_threshold: sqlExcluded('overbook_red_threshold'),
        idle_threshold: sqlExcluded('idle_threshold'),
        mismatch_pct_threshold: sqlExcluded('mismatch_pct_threshold'),
        ot_max_hours_per_week: sqlExcluded('ot_max_hours_per_week'),
        required_training_hours: sqlExcluded('required_training_hours'),
        effective_date: sqlExcluded('effective_date'),
        source_row: sqlExcluded('source_row'),
        updated_at: sqlExcluded('updated_at'),
      },
    });

  return {
    tenantId,
    inserted: rows.length,
    configIds: configs.map((config) => config.config_id),
  };
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
