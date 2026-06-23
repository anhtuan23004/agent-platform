import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IngestionDomainConfig } from '@seta/ingestion';
import {
  DomainConfigValidationError,
  FileDomainRegistry,
  parseDomainConfig,
} from '@seta/ingestion';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PMO_DOMAIN_CONFIG } from '../../src/backend/ingestion/pmo-domain-config.ts';

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = path.join('/tmp/opencode', 'domain-registry-test');

function writeTestConfig(domainId: string, config: unknown): void {
  const dir = path.join(TEST_DIR, domainId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'domain.json'), JSON.stringify(config, null, 2));
}

function makeMinimalConfig(overrides: Partial<IngestionDomainConfig> = {}): IngestionDomainConfig {
  return {
    domainId: 'test',
    version: '1.0.0',
    label: 'Test Domain',
    tables: [
      {
        id: 'test_table',
        label: 'Test Table',
        description: 'A test table',
        synonyms: ['test'],
        naturalKey: ['test_id'],
        duplicatePolicy: 'block',
        fields: [
          {
            name: 'test_id',
            label: 'Test ID',
            description: 'Test identifier',
            dataType: 'string',
            required: true,
            synonyms: ['id'],
          },
        ],
      },
    ],
    referenceRules: [],
    validationRules: [],
    publishPolicy: {
      requireApproval: true,
      allowDirectPublish: false,
      mode: 'staged',
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseDomainConfig', () => {
  it('parses a valid minimal config', () => {
    const config = parseDomainConfig(makeMinimalConfig());
    expect(config.domainId).toBe('test');
    expect(config.tables).toHaveLength(1);
    expect(config.tables[0]?.id).toBe('test_table');
  });

  it('rejects config with missing domainId', () => {
    const raw = makeMinimalConfig();
    (raw as unknown as Record<string, unknown>).domainId = '';
    expect(() => parseDomainConfig(raw)).toThrow();
  });

  it('rejects config with empty tables', () => {
    const raw = makeMinimalConfig({ tables: [] });
    expect(() => parseDomainConfig(raw)).toThrow();
  });

  it('validates naturalKey fields exist in table fields', () => {
    const config = makeMinimalConfig();
    config.tables[0]!.naturalKey = ['nonexistent_field'];
    expect(() => parseDomainConfig(config)).toThrow(DomainConfigValidationError);
    expect(() => parseDomainConfig(config)).toThrow('naturalKey field "nonexistent_field"');
  });

  it('validates referenceRules reference valid tables', () => {
    const config = makeMinimalConfig();
    config.referenceRules = [
      {
        sourceTable: 'nonexistent',
        sourceField: 'test_id',
        targetTable: 'test_table',
        targetField: 'test_id',
        blocking: true,
        resolutionActions: ['reject_run'],
      },
    ];
    expect(() => parseDomainConfig(config)).toThrow(DomainConfigValidationError);
    expect(() => parseDomainConfig(config)).toThrow('sourceTable "nonexistent"');
  });

  it('validates referenceRules reference valid fields', () => {
    const config = makeMinimalConfig();
    config.referenceRules = [
      {
        sourceTable: 'test_table',
        sourceField: 'nonexistent_field',
        targetTable: 'test_table',
        targetField: 'test_id',
        blocking: true,
        resolutionActions: ['reject_run'],
      },
    ];
    expect(() => parseDomainConfig(config)).toThrow(DomainConfigValidationError);
    expect(() => parseDomainConfig(config)).toThrow('sourceField "nonexistent_field"');
  });

  it('parses PMO domain config successfully', () => {
    const config = parseDomainConfig(PMO_DOMAIN_CONFIG);
    expect(config.domainId).toBe('pmo');
    expect(config.tables).toHaveLength(9);
    expect(config.referenceRules.length).toBeGreaterThan(0);
  });
});

describe('FileDomainRegistry', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('loads a valid domain config from file', async () => {
    writeTestConfig('test', makeMinimalConfig());
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    const config = await registry.load('test');
    expect(config.domainId).toBe('test');
    expect(config.tables).toHaveLength(1);
  });

  it('caches loaded configs', async () => {
    writeTestConfig('test', makeMinimalConfig());
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    const first = await registry.load('test');
    const second = await registry.load('test');
    expect(first).toBe(second); // same reference = cached
  });

  it('throws for unknown domain', async () => {
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    await expect(registry.load('nonexistent')).rejects.toThrow('Domain config not found');
  });

  it('throws for disabled domain', async () => {
    writeTestConfig('test', makeMinimalConfig());
    const registry = new FileDomainRegistry({
      catalogDir: TEST_DIR,
      enabledDomains: ['other'],
    });
    await expect(registry.load('test')).rejects.toThrow('not enabled');
  });

  it('throws when domainId in file mismatches directory name', async () => {
    writeTestConfig('wrongdir', makeMinimalConfig({ domainId: 'correct' }));
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    await expect(registry.load('wrongdir')).rejects.toThrow('mismatch');
  });

  it('throws for invalid JSON', async () => {
    const dir = path.join(TEST_DIR, 'badjson');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'domain.json'), '{ invalid json }');
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    await expect(registry.load('badjson')).rejects.toThrow('invalid JSON');
  });

  it('listEnabled returns all discovered domains', async () => {
    writeTestConfig('alpha', makeMinimalConfig({ domainId: 'alpha', label: 'Alpha' }));
    writeTestConfig('beta', makeMinimalConfig({ domainId: 'beta', label: 'Beta' }));
    const registry = new FileDomainRegistry({ catalogDir: TEST_DIR });
    const list = await registry.listEnabled();
    expect(list).toHaveLength(2);
    const ids = list.map((d) => d.domainId).sort();
    expect(ids).toEqual(['alpha', 'beta']);
  });

  it('listEnabled respects enabledDomains filter', async () => {
    writeTestConfig('alpha', makeMinimalConfig({ domainId: 'alpha', label: 'Alpha' }));
    writeTestConfig('beta', makeMinimalConfig({ domainId: 'beta', label: 'Beta' }));
    const registry = new FileDomainRegistry({
      catalogDir: TEST_DIR,
      enabledDomains: ['alpha'],
    });
    const list = await registry.listEnabled();
    expect(list).toHaveLength(1);
    expect(list[0]?.domainId).toBe('alpha');
  });

  it('listEnabled returns empty for nonexistent catalog dir', async () => {
    const registry = new FileDomainRegistry({ catalogDir: '/nonexistent/path' });
    const list = await registry.listEnabled();
    expect(list).toEqual([]);
  });
});

describe('PMO domain.json parity', () => {
  it('JSON config file matches in-code PMO_DOMAIN_CONFIG', () => {
    const jsonPath = path.resolve(
      process.cwd(),
      '../../../config/ingestion-domains/pmo/domain.json',
    );

    // Skip if JSON file not accessible (CI may run from different cwd)
    if (!fs.existsSync(jsonPath)) return;

    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const jsonConfig = parseDomainConfig(raw);

    // Verify key structural properties match
    expect(jsonConfig.domainId).toBe(PMO_DOMAIN_CONFIG.domainId);
    expect(jsonConfig.version).toBe(PMO_DOMAIN_CONFIG.version);
    expect(jsonConfig.tables.length).toBe(PMO_DOMAIN_CONFIG.tables.length);
    expect(jsonConfig.referenceRules.length).toBe(PMO_DOMAIN_CONFIG.referenceRules.length);

    // Verify all table IDs match
    const jsonTableIds = jsonConfig.tables.map((t) => t.id).sort();
    const codeTableIds = PMO_DOMAIN_CONFIG.tables.map((t) => t.id).sort();
    expect(jsonTableIds).toEqual(codeTableIds);

    // Verify field counts per table
    for (const codeTable of PMO_DOMAIN_CONFIG.tables) {
      const jsonTable = jsonConfig.tables.find((t) => t.id === codeTable.id);
      expect(jsonTable, `Table ${codeTable.id} not found in JSON`).toBeDefined();
      expect(jsonTable!.fields.length).toBe(codeTable.fields.length);
      expect(jsonTable!.naturalKey).toEqual(codeTable.naturalKey);
      expect(jsonTable!.duplicatePolicy).toBe(codeTable.duplicatePolicy);
    }
  });
});
