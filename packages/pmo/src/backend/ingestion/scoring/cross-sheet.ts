import type { IngestionDomainConfig } from '@seta/ingestion';
import type { CanonicalField } from '../canonical-types.ts';
import { PMO_DOMAIN_CONFIG } from '../pmo-domain-config.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrossSheetScoreResult {
  score: number; // 0–1
  details: string;
}

// ── Derive cross-referenceable ID fields from domain config ──────────────────

function buildIdFields(domainConfig: IngestionDomainConfig): Set<string> {
  const ids = new Set<string>();
  for (const rule of domainConfig.referenceRules) {
    ids.add(rule.sourceField);
    ids.add(rule.targetField);
  }
  // Also include any field ending in _id that appears in natural keys
  for (const table of domainConfig.tables) {
    for (const nk of table.naturalKey) {
      if (nk.endsWith('_id')) ids.add(nk);
    }
  }
  // Include fields referencing IDs (e.g. pm_id, line_manager_id) by convention
  for (const table of domainConfig.tables) {
    for (const field of table.fields) {
      if (field.name.endsWith('_id') && field.dataType === 'string') {
        ids.add(field.name);
      }
    }
  }
  return ids;
}

let cachedIdFields: Set<string> | null = null;
let cachedConfigKey: string | null = null;

function getIdFields(domainConfig: IngestionDomainConfig): Set<string> {
  const key = `${domainConfig.domainId}:${domainConfig.version}`;
  if (cachedIdFields && cachedConfigKey === key) return cachedIdFields;
  cachedIdFields = buildIdFields(domainConfig);
  cachedConfigKey = key;
  return cachedIdFields;
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreCrossSheet(
  columnValues: string[],
  canonicalField: CanonicalField,
  masterValues: string[] | null, // values from master sheet, if available
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): CrossSheetScoreResult {
  const idFields = getIdFields(domainConfig);

  // Only score ID fields that have a cross-sheet reference
  if (!idFields.has(canonicalField.name)) {
    // Non-ID fields: no cross-sheet signal available → neutral
    return { score: 0.5, details: 'No cross-sheet signal for this field type' };
  }

  // No master sheet available → neutral
  if (!masterValues || masterValues.length === 0) {
    return { score: 0.5, details: 'Master sheet not available' };
  }

  const nonEmpty = columnValues.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) {
    return { score: 0, details: 'No values to compare' };
  }

  // Compute overlap: how many values in this column exist in the master
  const masterSet = new Set(masterValues.map((v) => v.trim().toLowerCase()));
  const matchCount = nonEmpty.filter((v) => masterSet.has(v.trim().toLowerCase())).length;
  const overlapRatio = matchCount / nonEmpty.length;

  // Map overlap ratio to score
  let score: number;
  if (overlapRatio >= 0.9) score = 1.0;
  else if (overlapRatio >= 0.75) score = 0.85;
  else if (overlapRatio >= 0.6) score = 0.7;
  else if (overlapRatio >= 0.4) score = 0.5;
  else if (overlapRatio >= 0.2) score = 0.3;
  else score = 0.1;

  return {
    score,
    details: `overlap=${(overlapRatio * 100).toFixed(0)}% (${matchCount}/${nonEmpty.length} match master)`,
  };
}
