import type { CanonicalSchema, CanonicalTable } from './canonical-schema.ts';
import { PMO_CANONICAL_SCHEMA } from './canonical-schema.ts';
import type { SheetProfile } from './profile-columns.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SheetRoleCandidate {
  candidateRole: string; // canonical table id
  confidence: number; // 0–1
  evidence: string[];
}

export interface SheetRoleDetection {
  sheetName: string;
  topCandidate: SheetRoleCandidate | null; // highest confidence, or null if all < 0.30
  otherCandidates: SheetRoleCandidate[]; // remaining candidates sorted desc
}

// ── Sheet name scoring ───────────────────────────────────────────────────────

function scoreSheetName(sheetName: string, table: CanonicalTable): number {
  const normalized = sheetName
    .toLowerCase()
    .replace(/[_\-\s.]+/g, ' ')
    .trim();

  for (const pattern of table.sheetNamePatterns) {
    // Use word boundaries to avoid substring false positives (e.g. "ra" in "Random")
    const regex = new RegExp(`(?:^|\\b|\\s)${pattern}(?:\\b|\\s|$)`, 'i');
    if (regex.test(normalized) || regex.test(sheetName)) {
      return 1.0;
    }
  }

  // Partial match: table id words appear in sheet name
  const tableWords = table.id.replace(/_/g, ' ').split(' ');
  const matchedWords = tableWords.filter((w) => normalized.includes(w));
  if (matchedWords.length > 0) {
    return (matchedWords.length / tableWords.length) * 0.7;
  }

  return 0;
}

// ── Column set scoring ───────────────────────────────────────────────────────

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreColumnSet(profile: SheetProfile, table: CanonicalTable): number {
  const requiredFields = table.fields.filter((f) => f.required);
  if (requiredFields.length === 0) return 0;

  const normalizedHeaders = profile.columns.map((c) => normalizeHeader(c.columnName));

  let matchedCount = 0;

  for (const field of requiredFields) {
    const allTerms = [field.name, ...field.synonyms].map(normalizeHeader);

    const found = normalizedHeaders.some((header) =>
      allTerms.some((term) => header === term || header.includes(term) || term.includes(header)),
    );

    if (found) matchedCount++;
  }

  return matchedCount / requiredFields.length;
}

// ── Row pattern scoring ──────────────────────────────────────────────────────

function scoreRowPattern(profile: SheetProfile, table: CanonicalTable): number {
  // Structural signals based on table type
  switch (table.id) {
    case 'resource_allocation': {
      // RA typically has moderate row count, date columns present, percentage column
      const hasDateCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)),
      );
      const hasPercentCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d+(\.\d+)?%$/.test(v)),
      );
      let score = 0;
      if (hasDateCol) score += 0.5;
      if (hasPercentCol) score += 0.5;
      return score;
    }

    case 'timesheet': {
      // Timesheet has many rows per member (high row count relative to unique members)
      const hasNumericCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d+(\.\d+)?$/.test(v.trim())),
      );
      const hasDateCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)),
      );
      const highRowCount = profile.rowCount > 20;
      let score = 0;
      if (hasNumericCol) score += 0.35;
      if (hasDateCol) score += 0.35;
      if (highRowCount) score += 0.3;
      return score;
    }

    case 'leave': {
      // Leave has date ranges and category-like columns
      const hasDateCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)),
      );
      const hasLowCardinalityCol = profile.columns.some((c) => {
        const nonEmpty = c.sampleValues.length;
        const unique = new Set(c.sampleValues.map((v) => v.toLowerCase())).size;
        return nonEmpty >= 3 && unique <= 10 && unique < nonEmpty;
      });
      let score = 0;
      if (hasDateCol) score += 0.5;
      if (hasLowCardinalityCol) score += 0.5;
      return score;
    }

    case 'member_master': {
      // Master tables have high uniqueness, relatively few rows, text-heavy
      const hasHighUniqueCol = profile.columns.some((c) => {
        const nonEmpty = c.sampleValues.length;
        const unique = new Set(c.sampleValues.map((v) => v.toLowerCase())).size;
        return unique === nonEmpty && nonEmpty >= 3;
      });
      const hasEmailLike = profile.columns.some((c) =>
        c.sampleValues.some((v) => /.+@.+\..+/.test(v)),
      );
      let score = 0;
      if (hasHighUniqueCol) score += 0.5;
      if (hasEmailLike) score += 0.5;
      return Math.min(score, 1.0);
    }

    case 'project_master': {
      // Project master: ID + name, few rows, text-heavy
      const hasHighUniqueCol = profile.columns.some((c) => {
        const nonEmpty = c.sampleValues.length;
        const unique = new Set(c.sampleValues.map((v) => v.toLowerCase())).size;
        return unique === nonEmpty && nonEmpty >= 3;
      });
      const hasDateCol = profile.columns.some((c) =>
        c.sampleValues.some((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)),
      );
      let score = 0;
      if (hasHighUniqueCol) score += 0.6;
      if (hasDateCol) score += 0.4;
      return Math.min(score, 1.0);
    }

    default:
      return 0.5; // neutral
  }
}

// ── Main function ────────────────────────────────────────────────────────────

export function detectSheetRoles(
  sheets: SheetProfile[],
  schema: CanonicalSchema = PMO_CANONICAL_SCHEMA,
): SheetRoleDetection[] {
  return sheets.map((profile) => {
    const candidates: SheetRoleCandidate[] = [];

    for (const table of schema.tables) {
      const nameScore = scoreSheetName(profile.sheetName, table);
      const columnScore = scoreColumnSet(profile, table);
      const patternScore = scoreRowPattern(profile, table);

      const confidence = 0.45 * nameScore + 0.35 * columnScore + 0.2 * patternScore;

      const evidence: string[] = [];
      if (nameScore > 0)
        evidence.push(
          `sheet name matches '${table.id}' pattern (${(nameScore * 100).toFixed(0)}%)`,
        );
      if (columnScore > 0)
        evidence.push(`${(columnScore * 100).toFixed(0)}% of required fields found in headers`);
      if (patternScore > 0)
        evidence.push(
          `row patterns consistent with '${table.id}' (${(patternScore * 100).toFixed(0)}%)`,
        );

      candidates.push({
        candidateRole: table.id,
        confidence: Math.round(confidence * 100) / 100,
        evidence,
      });
    }

    // Sort descending by confidence
    candidates.sort((a, b) => b.confidence - a.confidence);

    const topCandidate: SheetRoleCandidate | null =
      candidates.length > 0 && (candidates[0]?.confidence ?? 0) >= 0.3
        ? (candidates[0] ?? null)
        : null;
    const otherCandidates = topCandidate ? candidates.slice(1) : candidates;

    return {
      sheetName: profile.sheetName,
      topCandidate,
      otherCandidates,
    };
  });
}
