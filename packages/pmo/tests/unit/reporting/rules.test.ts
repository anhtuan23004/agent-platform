import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  auditLegacyRuleCompatibility,
  canonicalizeReportRules,
  classifyReportMetric,
  hashReportRules,
  loadPmoReportRuleCatalog,
  type PmoReportRuleSet,
  type ReportRuleSource,
  resetPmoReportRuleCatalogCacheForTests,
  resolveReportRules,
  validateRuleSet,
} from '../../../src/backend/reporting/rules/index.ts';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

afterEach(() => {
  resetPmoReportRuleCatalogCacheForTests();
  delete process.env.PMO_REPORT_RULES_DIR;
});

function loadDefault(): PmoReportRuleSet {
  return loadPmoReportRuleCatalog({ bypassCache: true })[0] as PmoReportRuleSet;
}

function cloneRuleSet(): PmoReportRuleSet {
  return structuredClone(loadDefault());
}

describe('PMO report rule validation and boundaries', () => {
  it.each([
    [0.7499, 'red'],
    [0.75, 'yellow'],
    [0.8499, 'yellow'],
    [0.85, 'green'],
    [1.1, 'green'],
    [1.1001, 'yellow'],
    [1.1999, 'yellow'],
    [1.2, 'red'],
  ] as const)('classifies N01 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N01', value)).toBe(expected);
  });

  it.each([
    [0.75, 'red'],
    [0.7501, 'yellow'],
    [0.8499, 'yellow'],
    [0.85, 'green'],
    [1.1, 'green'],
    [1.1001, 'yellow'],
    [1.1999, 'yellow'],
    [1.2, 'red'],
  ] as const)('classifies N06 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N06', value)).toBe(expected);
  });

  // N02 Utilization: green 0.75-0.9, yellow 0.6-<0.75 | >0.9-1.0, red <0.6 | >1.0
  it.each([
    [0.5999, 'red'],
    [0.6, 'yellow'],
    [0.7499, 'yellow'],
    [0.75, 'green'],
    [0.9, 'green'],
    [0.9001, 'yellow'],
    [1.0, 'yellow'],
    [1.0001, 'red'],
  ] as const)('classifies N02 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N02', value)).toBe(expected);
  });

  // N03 Billable rate: green >=0.8, yellow 0.7-<0.8, red <0.7
  it.each([
    [0.6999, 'red'],
    [0.7, 'yellow'],
    [0.7999, 'yellow'],
    [0.8, 'green'],
    [1.0, 'green'],
  ] as const)('classifies N03 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N03', value)).toBe(expected);
  });

  // N04 Bench rate: green <=0.1, yellow >0.1-0.2, red >0.2
  it.each([
    [0.05, 'green'],
    [0.1, 'green'],
    [0.1001, 'yellow'],
    [0.2, 'yellow'],
    [0.2001, 'red'],
    [0.3, 'red'],
  ] as const)('classifies N04 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N04', value)).toBe(expected);
  });

  // N05 Overtime ratio: green <=0.05, yellow >0.05-0.15, red >0.15
  it.each([
    [0.04, 'green'],
    [0.05, 'green'],
    [0.0501, 'yellow'],
    [0.15, 'yellow'],
    [0.1501, 'red'],
    [0.25, 'red'],
  ] as const)('classifies N05 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N05', value)).toBe(expected);
  });

  // N12 Training compliance: green >=1.0, yellow 0.85-<1.0, red <0.85
  it.each([
    [0.8499, 'red'],
    [0.85, 'yellow'],
    [0.9999, 'yellow'],
    [1.0, 'green'],
    [1.2, 'green'],
  ] as const)('classifies N12 value %s as %s', (value, expected) => {
    expect(classifyReportMetric(loadDefault(), 'N12', value)).toBe(expected);
  });

  it('rejects overlapping metric bands with a JSON path', () => {
    const rules = cloneRuleSet();
    rules.metrics.N03.bands.yellow[0] = { gte: 0.7, lte: 0.81 };

    expect(() => validateRuleSet(rules)).toThrow('metrics.N03.bands: overlapping intervals at 0.8');
  });

  it('rejects gaps between metric bands with a JSON path', () => {
    const rules = cloneRuleSet();
    rules.metrics.N04.bands.yellow[0] = { gt: 0.11, lte: 0.2 };

    expect(() => validateRuleSet(rules)).toThrow('metrics.N04.bands: gap between 0.1 and 0.11');
  });

  it('rejects invalid recommendation candidate counts and scoring totals', () => {
    const invalidCount = cloneRuleSet();
    invalidCount.recommendation.candidateCount.default = 6;
    expect(() => validateRuleSet(invalidCount)).toThrow('recommendation.candidateCount.default');

    const invalidWeights = cloneRuleSet();
    invalidWeights.recommendation.scoring.riskAdjustment = 0.2;
    expect(() => validateRuleSet(invalidWeights)).toThrow(
      'recommendation.scoring: weights must sum to 1',
    );
  });
});

describe('PMO report rule resolution', () => {
  it('selects latest applicable rule by effective date', async () => {
    const older = cloneRuleSet();
    older.version = '2026-01-01';
    older.effectiveFrom = '2026-01-01';
    const newer = cloneRuleSet();
    newer.version = '2026-07-01';
    newer.effectiveFrom = '2026-07-01';
    newer.classification.overbook.red = { gte: 1.25 };
    newer.classification.overbook.yellow = { gt: 1.1, lt: 1.25 };

    const source: ReportRuleSource = {
      listRuleSets: vi.fn(async () => [newer, older]),
    };

    const before = await resolveReportRules({
      tenantId: TENANT_ID,
      effectiveAt: new Date('2026-06-30T00:00:00.000Z'),
      source,
    });
    const after = await resolveReportRules({
      tenantId: TENANT_ID,
      effectiveAt: new Date('2026-07-02T00:00:00.000Z'),
      source,
    });

    expect(before.version).toBe('2026-01-01');
    expect(after.version).toBe('2026-07-01');
    expect(source.listRuleSets).toHaveBeenCalledWith({ tenantId: TENANT_ID });
  });

  it('produces stable canonical JSON and SHA-256 regardless of key order', () => {
    const left = { b: 2, nested: { z: 1, a: 2 }, a: 1 };
    const right = { a: 1, nested: { a: 2, z: 1 }, b: 2 };

    expect(canonicalizeReportRules(left)).toBe(canonicalizeReportRules(right));
    expect(hashReportRules(left)).toBe(hashReportRules(right));
    expect(hashReportRules(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails fast when configured catalog is invalid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pmo-report-rules-'));
    writeFileSync(join(dir, 'invalid.json'), JSON.stringify({ schemaVersion: 1 }));
    process.env.PMO_REPORT_RULES_DIR = dir;

    expect(() => loadPmoReportRuleCatalog({ bypassCache: true })).toThrow(
      'PMO report rule catalog validation failed',
    );
  });
});

describe('legacy PMO rule compatibility audit', () => {
  it('maps matching legacy thresholds without warnings', () => {
    const logger = { warn: vi.fn() };
    const result = auditLegacyRuleCompatibility({
      ruleSet: loadDefault(),
      configRows: [
        {
          config_id: 'CFG-001',
          rule_name: 'SETA-08-SOP-001 RAG thresholds',
          overbook_threshold: 1.1,
          overbook_red_threshold: 1.2,
          idle_threshold: 0.75,
          mismatch_pct_threshold: 0.2,
          ot_max_hours_per_week: 48,
          effective_date: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      kpiRows: [{ norm_id: 'N06', formula: 'Actual_h / Planned_h' }],
      logger,
    });

    expect(result.mismatches).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns and logs field-level mismatches', () => {
    const logger = { warn: vi.fn() };
    const result = auditLegacyRuleCompatibility({
      ruleSet: loadDefault(),
      configRows: [
        {
          config_id: 'CFG-old',
          rule_name: 'Old thresholds',
          overbook_threshold: 1.05,
          overbook_red_threshold: 1.15,
          idle_threshold: 0.8,
          mismatch_pct_threshold: 0.1,
          ot_max_hours_per_week: 40,
          effective_date: new Date('2025-01-01T00:00:00.000Z'),
        },
      ],
      kpiRows: [{ norm_id: 'N06', formula: 'wrong formula' }],
      logger,
    });

    expect(result.mismatches.map((item) => item.path)).toEqual([
      'classification.overbook.yellow.gt',
      'classification.overbook.red.gte',
      'classification.idle.red.lt',
      'limits.mismatchPctThreshold',
      'limits.otMaxHoursPerWeek',
      'metrics.N06.formula',
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
