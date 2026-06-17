import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { IngestionDomainConfig } from './domain-config.ts';

export interface IngestionDomainRegistry {
  load(domainId: string): Promise<IngestionDomainConfig>;
  listEnabled(): Promise<Array<{ domainId: string; label: string; version: string }>>;
}

const IngestionFieldDataTypeSchema = z.enum([
  'string',
  'number',
  'date',
  'percentage',
  'boolean',
  'enum',
]);

const DuplicatePolicySchema = z.enum(['allow', 'skip', 'block']);

const IngestionFieldConfigSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  dataType: IngestionFieldDataTypeSchema,
  required: z.boolean(),
  synonyms: z.array(z.string()),
  valuePattern: z.string().optional(),
});

const IngestionTableConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  synonyms: z.array(z.string()),
  naturalKey: z.array(z.string()).min(1),
  duplicatePolicy: DuplicatePolicySchema,
  fields: z.array(IngestionFieldConfigSchema).min(1),
});

const ResolutionActionSchema = z.enum([
  'add_missing_master',
  'map_to_existing',
  'exclude_rows',
  'reject_run',
]);

const IngestionReferenceRuleSchema = z.object({
  sourceTable: z.string().min(1),
  sourceField: z.string().min(1),
  targetTable: z.string().min(1),
  targetField: z.string().min(1),
  blocking: z.boolean(),
  resolutionActions: z.array(ResolutionActionSchema),
});

const IngestionValidationRuleSchema = z.object({
  id: z.string().min(1),
  tableId: z.string().min(1),
  fieldName: z.string().optional(),
  type: z.enum(['required', 'range', 'enum', 'date_order', 'custom']),
  severity: z.enum(['info', 'warning', 'blocking']),
  config: z.record(z.string(), z.unknown()),
});

const IngestionPublishPolicySchema = z.object({
  requireApproval: z.boolean(),
  allowDirectPublish: z.boolean(),
  mode: z.enum(['staged', 'direct']),
});

export const IngestionDomainConfigSchema = z.object({
  domainId: z.string().min(1),
  version: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  tables: z.array(IngestionTableConfigSchema).min(1),
  referenceRules: z.array(IngestionReferenceRuleSchema),
  validationRules: z.array(IngestionValidationRuleSchema),
  publishPolicy: IngestionPublishPolicySchema,
});

export class DomainConfigValidationError extends Error {
  constructor(
    public readonly domainId: string,
    public readonly issues: string[],
  ) {
    super(
      `Domain config "${domainId}" validation failed:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'DomainConfigValidationError';
  }
}

function validateSemantics(config: IngestionDomainConfig): string[] {
  const issues: string[] = [];
  const tableIds = new Set(config.tables.map((t) => t.id));

  for (const table of config.tables) {
    const fieldNames = new Set(table.fields.map((f) => f.name));
    for (const nk of table.naturalKey) {
      if (!fieldNames.has(nk)) {
        issues.push(`Table "${table.id}": naturalKey field "${nk}" is not defined in fields`);
      }
    }
  }

  for (const rule of config.referenceRules) {
    if (!tableIds.has(rule.sourceTable)) {
      issues.push(`Reference rule: sourceTable "${rule.sourceTable}" is not a known table`);
    }
    if (!tableIds.has(rule.targetTable)) {
      issues.push(`Reference rule: targetTable "${rule.targetTable}" is not a known table`);
    }

    const sourceTable = config.tables.find((t) => t.id === rule.sourceTable);
    if (sourceTable) {
      const fieldNames = new Set(sourceTable.fields.map((f) => f.name));
      if (!fieldNames.has(rule.sourceField)) {
        issues.push(
          `Reference rule: sourceField "${rule.sourceField}" not found in table "${rule.sourceTable}"`,
        );
      }
    }

    const targetTable = config.tables.find((t) => t.id === rule.targetTable);
    if (targetTable) {
      const fieldNames = new Set(targetTable.fields.map((f) => f.name));
      if (!fieldNames.has(rule.targetField)) {
        issues.push(
          `Reference rule: targetField "${rule.targetField}" not found in table "${rule.targetTable}"`,
        );
      }
    }
  }

  for (const rule of config.validationRules) {
    if (!tableIds.has(rule.tableId)) {
      issues.push(`Validation rule "${rule.id}": tableId "${rule.tableId}" is not a known table`);
    }
    if (rule.fieldName) {
      const table = config.tables.find((t) => t.id === rule.tableId);
      if (table) {
        const fieldNames = new Set(table.fields.map((f) => f.name));
        if (!fieldNames.has(rule.fieldName)) {
          issues.push(
            `Validation rule "${rule.id}": fieldName "${rule.fieldName}" not found in table "${rule.tableId}"`,
          );
        }
      }
    }
  }

  return issues;
}

export function parseDomainConfig(raw: unknown): IngestionDomainConfig {
  const parsed = IngestionDomainConfigSchema.parse(raw);
  const issues = validateSemantics(parsed);
  if (issues.length > 0) {
    throw new DomainConfigValidationError(
      typeof raw === 'object' && raw !== null && 'domainId' in raw
        ? String((raw as Record<string, unknown>).domainId)
        : '<unknown>',
      issues,
    );
  }
  return parsed;
}

export interface FileDomainRegistryOptions {
  catalogDir: string;
  enabledDomains?: string[];
}

export class FileDomainRegistry implements IngestionDomainRegistry {
  private readonly catalogDir: string;
  private readonly enabledDomains: Set<string> | null;
  private readonly cache = new Map<string, IngestionDomainConfig>();

  constructor(options: FileDomainRegistryOptions) {
    this.catalogDir = path.resolve(options.catalogDir);
    this.enabledDomains =
      options.enabledDomains && options.enabledDomains.length > 0
        ? new Set(options.enabledDomains)
        : null;
  }

  async load(domainId: string): Promise<IngestionDomainConfig> {
    if (this.enabledDomains && !this.enabledDomains.has(domainId)) {
      throw new Error(
        `Domain "${domainId}" is not enabled. Enabled domains: ${[...this.enabledDomains].join(', ')}`,
      );
    }

    const cached = this.cache.get(domainId);
    if (cached) return cached;

    const configPath = path.join(this.catalogDir, domainId, 'domain.json');

    let raw: string;
    try {
      raw = await fs.promises.readFile(configPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Domain config not found: ${configPath}. Ensure a domain.json file exists for domain "${domainId}".`,
        );
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Domain config "${domainId}" contains invalid JSON: ${configPath}`);
    }

    const config = parseDomainConfig(parsed);

    if (config.domainId !== domainId) {
      throw new Error(
        `Domain config file mismatch: file is at "${domainId}/domain.json" but declares domainId="${config.domainId}"`,
      );
    }

    this.cache.set(domainId, config);
    return config;
  }

  async listEnabled(): Promise<Array<{ domainId: string; label: string; version: string }>> {
    let domainDirs: string[];
    try {
      const entries = await fs.promises.readdir(this.catalogDir, { withFileTypes: true });
      domainDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const results: Array<{ domainId: string; label: string; version: string }> = [];

    for (const dir of domainDirs) {
      if (this.enabledDomains && !this.enabledDomains.has(dir)) continue;

      try {
        const config = await this.load(dir);
        results.push({
          domainId: config.domainId,
          label: config.label,
          version: config.version,
        });
      } catch {
        // Invalid domain configs are ignored during listing but still fail direct load.
      }
    }

    return results;
  }
}

const DEFAULT_CATALOG_DIR = './config/ingestion-domains';

export function createDomainRegistryFromEnv(): IngestionDomainRegistry {
  const catalogDir = process.env.INGESTION_DOMAIN_CATALOG_DIR ?? DEFAULT_CATALOG_DIR;
  const enabledRaw = process.env.INGESTION_ENABLED_DOMAINS;
  const enabledDomains = enabledRaw
    ? enabledRaw
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    : undefined;

  return new FileDomainRegistry({ catalogDir, enabledDomains });
}
