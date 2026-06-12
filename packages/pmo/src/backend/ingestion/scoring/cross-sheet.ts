import type { CanonicalField } from '../canonical-schema.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrossSheetScoreResult {
  score: number; // 0–1
  details: string;
}

// ── ID fields that can be cross-referenced ───────────────────────────────────

const ID_FIELDS = new Set(['member_id', 'project_id', 'pm_id', 'line_manager_id', 'config_id']);

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreCrossSheet(
  columnValues: string[],
  canonicalField: CanonicalField,
  masterValues: string[] | null, // values from master sheet, if available
): CrossSheetScoreResult {
  // Only score ID fields that have a cross-sheet reference
  if (!ID_FIELDS.has(canonicalField.name)) {
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
