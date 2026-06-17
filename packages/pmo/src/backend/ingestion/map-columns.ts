import type { CanonicalField, CanonicalSchema } from './canonical-schema.ts';
import type { SheetRoleCandidate } from './detect-sheet-role.ts';
import type { IngestionDomainConfig } from './domain-config.ts';
import { type LlmMappingHintMap, llmMappingHintKey } from './llm-mapping-hints.ts';
import { PMO_DOMAIN_CANONICAL_SCHEMA, PMO_DOMAIN_CONFIG } from './pmo-domain-config.ts';
import type { SheetProfile } from './profile-columns.ts';
import { scoreCrossSheet } from './scoring/cross-sheet.ts';
import { scoreDataType } from './scoring/data-type.ts';
import { scoreHeaderSimilarity } from './scoring/header-similarity.ts';
import { scoreSheetContext } from './scoring/sheet-context.ts';
import { scoreValuePattern } from './scoring/value-pattern.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ColumnMapping {
  sourceColumn: string;
  canonicalField: string;
  confidence: number;
  evidence: string;
  status: 'auto_accept' | 'needs_review' | 'blocked';
  candidates?: Array<{
    sourceColumn: string;
    confidence: number;
    blocked: boolean;
  }>;
  scoringBreakdown: {
    headerSimilarity: number;
    valuePattern: number;
    dataType: number;
    sheetContext: number;
    crossSheet: number;
    llmSemantic: number;
  };
}

export interface TableMapping {
  tableId: string;
  sourceSheet: string;
  headerRow: number;
  tableConfidence: number;
  mappings: ColumnMapping[];
  unmappedRequired: string[]; // required fields with no candidate
  ambiguous: string[]; // fields with top-2 gap < 0.10
}

// ── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  headerSimilarity: 0.35,
  valuePattern: 0.3,
  dataType: 0.15,
  sheetContext: 0.1,
  crossSheet: 0.1,
};

const DEFAULT_LLM_BONUS_WEIGHT = 0.06;
const MIN_BASE_FOR_LLM_ADJUSTMENT = 0.6;
const MIN_BASE_FOR_AUTO_ACCEPT = 0.9;
const STRONG_BASE_FOR_LLM_DISAGREEMENT = 0.8;
const LOW_LLM_DISAGREEMENT_THRESHOLD = 0.2;

export interface MapColumnsOptions {
  llmHints?: LlmMappingHintMap | null;
  llmBonusWeight?: number;
  domainConfig?: IngestionDomainConfig;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

// ── Helper: get master values for cross-sheet scoring ────────────────────────
// Derives master table lookups from domainConfig.referenceRules instead of hardcoding table IDs.

function buildMasterTableLookup(domainConfig: IngestionDomainConfig): Map<string, string> {
  // Maps sourceField -> targetTable for reference rule lookups
  // e.g. member_id -> member_master, project_id -> project_master
  const lookup = new Map<string, string>();
  for (const rule of domainConfig.referenceRules) {
    lookup.set(rule.sourceField, rule.targetTable);
  }
  // Also include self-referencing ID fields (e.g. pm_id, line_manager_id -> member_master)
  // by finding fields with _id suffix that share a targetField with an existing rule
  for (const table of domainConfig.tables) {
    for (const field of table.fields) {
      if (field.name.endsWith('_id') && !lookup.has(field.name)) {
        // Check if any reference rule's targetField matches this field name pattern
        for (const rule of domainConfig.referenceRules) {
          if (rule.targetField === field.name) {
            lookup.set(field.name, rule.targetTable);
          }
        }
      }
    }
  }
  return lookup;
}

function getMasterValues(
  fieldName: string,
  allSheetProfiles: SheetProfile[],
  schema: CanonicalSchema,
  domainConfig: IngestionDomainConfig,
): string[] | null {
  const masterLookup = buildMasterTableLookup(domainConfig);
  const masterTableId = masterLookup.get(fieldName) ?? null;

  if (!masterTableId) return null;

  const masterTable = schema.tables.find((t) => t.id === masterTableId);
  if (!masterTable) return null;

  // Find a sheet profile that looks like the master table (by name pattern)
  for (const profile of allSheetProfiles) {
    const normalizedName = profile.sheetName.toLowerCase().replace(/[_\-\s.]+/g, ' ');
    const matches = masterTable.sheetNamePatterns.some((pattern) => {
      const regex = new RegExp(`(?:^|\\b|\\s)${pattern}(?:\\b|\\s|$)`, 'i');
      return regex.test(normalizedName) || regex.test(profile.sheetName);
    });

    if (matches) {
      // Find the ID column in this sheet (first column that looks like the master's primary key)
      const masterIdField = masterTable.fields.find((f) => f.name.endsWith('_id') && f.required);
      if (!masterIdField) return null;

      // Try to find column by header name match
      for (const col of profile.columns) {
        const headerResult = scoreHeaderSimilarity(col.columnName, masterIdField);
        if (headerResult.score >= 0.9) {
          const values =
            profile.columns.find((c) => c.columnName === col.columnName)?.sampleValues ?? [];
          return values.length > 0 ? values : null;
        }
      }
    }
  }

  return null;
}

// ── Main function ────────────────────────────────────────────────────────────

export function mapColumns(
  sheetProfile: SheetProfile,
  sheetRole: SheetRoleCandidate,
  allSheetProfiles: SheetProfile[],
  schema: CanonicalSchema = PMO_DOMAIN_CANONICAL_SCHEMA,
  options: MapColumnsOptions = {},
): TableMapping {
  const table = schema.tables.find((t) => t.id === sheetRole.candidateRole);
  if (!table) {
    return {
      tableId: sheetRole.candidateRole,
      sourceSheet: sheetProfile.sheetName,
      headerRow: sheetProfile.headerRow,
      tableConfidence: 0,
      mappings: [],
      unmappedRequired: [],
      ambiguous: [],
    };
  }

  // Score every (sourceColumn, canonicalField) pair
  interface ScoredCandidate {
    sourceColumn: string;
    field: CanonicalField;
    baseConfidence: number;
    confidence: number;
    breakdown: ColumnMapping['scoringBreakdown'];
    blocked: boolean;
  }

  const allCandidates: ScoredCandidate[] = [];
  const llmBonusWeight = clamp01(options.llmBonusWeight ?? DEFAULT_LLM_BONUS_WEIGHT);

  const domainConfig = options.domainConfig ?? PMO_DOMAIN_CONFIG;

  for (const field of table.fields) {
    const masterValues = getMasterValues(field.name, allSheetProfiles, schema, domainConfig);

    for (const col of sheetProfile.columns) {
      // Get all values for this column from sheet rows
      const allValues =
        sheetProfile.columns.find((c) => c.columnName === col.columnName)?.sampleValues ?? [];

      // Score with all 5 scorers
      const headerResult = scoreHeaderSimilarity(col.columnName, field);
      const valueResult = scoreValuePattern(
        {
          columnName: col.columnName,
          inferredType: 'string',
          nullRate: 0,
          uniqueCount: 0,
          uniqueRate: 0,
          sampleValues: allValues,
          valuePattern: null,
          stats: {},
        },
        field,
        allValues,
      );
      const dataTypeResult = scoreDataType(
        {
          columnName: col.columnName,
          inferredType: 'string',
          nullRate: 0,
          uniqueCount: 0,
          uniqueRate: 0,
          sampleValues: allValues,
          valuePattern: null,
          stats: {},
        },
        field,
        allValues,
      );
      const contextScore = scoreSheetContext(sheetRole, field, domainConfig);
      const crossSheetResult = scoreCrossSheet(allValues, field, masterValues, domainConfig);
      const llmSemantic =
        options.llmHints?.get(llmMappingHintKey(field.name, col.columnName)) ?? 0.5;

      const breakdown = {
        headerSimilarity: headerResult.score,
        valuePattern: valueResult.score,
        dataType: dataTypeResult.score,
        sheetContext: contextScore,
        crossSheet: crossSheetResult.score,
        llmSemantic,
      };

      const baselineConfidence =
        WEIGHTS.headerSimilarity * breakdown.headerSimilarity +
        WEIGHTS.valuePattern * breakdown.valuePattern +
        WEIGHTS.dataType * breakdown.dataType +
        WEIGHTS.sheetContext * breakdown.sheetContext +
        WEIGHTS.crossSheet * breakdown.crossSheet;

      const llmAdjustment =
        baselineConfidence >= MIN_BASE_FOR_LLM_ADJUSTMENT
          ? llmBonusWeight * (breakdown.llmSemantic - 0.5)
          : 0;

      // A small LLM bonus/penalty nudges confidence without overriding deterministic signals.
      const confidence = clamp01(baselineConfidence + llmAdjustment);

      allCandidates.push({
        sourceColumn: col.columnName,
        field,
        baseConfidence: Math.round(baselineConfidence * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        breakdown,
        blocked: dataTypeResult.blocked,
      });
    }
  }

  // ── Global one-to-one assignment (greedy) ──────────────────────────────────

  // Sort all candidates descending by confidence
  allCandidates.sort((a, b) => b.confidence - a.confidence);

  const assignedColumns = new Set<string>();
  const assignedFields = new Set<string>();
  const mappings: ColumnMapping[] = [];
  const ambiguous: string[] = [];

  const candidatesByField = new Map<
    string,
    Array<{ sourceColumn: string; confidence: number; blocked: boolean }>
  >();
  for (const candidate of allCandidates) {
    const byField = candidatesByField.get(candidate.field.name) ?? [];
    byField.push({
      sourceColumn: candidate.sourceColumn,
      confidence: candidate.confidence,
      blocked: candidate.blocked,
    });
    candidatesByField.set(candidate.field.name, byField);
  }

  // First pass: greedy assignment
  for (const candidate of allCandidates) {
    if (assignedColumns.has(candidate.sourceColumn)) continue;
    if (assignedFields.has(candidate.field.name)) continue;

    // Find the second-best candidate for this field (for gap calculation)
    const secondBest = allCandidates.find(
      (c) =>
        c.field.name === candidate.field.name &&
        c.sourceColumn !== candidate.sourceColumn &&
        !assignedColumns.has(c.sourceColumn),
    );
    const gap = secondBest ? candidate.confidence - secondBest.confidence : 1.0;
    const hasStrongLlmDisagreement =
      candidate.baseConfidence >= STRONG_BASE_FOR_LLM_DISAGREEMENT &&
      candidate.breakdown.llmSemantic <= LOW_LLM_DISAGREEMENT_THRESHOLD;

    // Determine status
    let status: ColumnMapping['status'];
    if (candidate.blocked) {
      status = 'blocked';
    } else if (
      !hasStrongLlmDisagreement &&
      candidate.confidence >= 0.9 &&
      candidate.baseConfidence >= MIN_BASE_FOR_AUTO_ACCEPT &&
      gap >= 0.1
    ) {
      status = 'auto_accept';
    } else if (candidate.confidence >= 0.7 || hasStrongLlmDisagreement) {
      status = 'needs_review';
    } else {
      // Below 0.70 → skip this assignment (field remains unmapped)
      continue;
    }

    // Check ambiguity
    if (gap < 0.1 && !candidate.blocked) {
      ambiguous.push(candidate.field.name);
      status = 'needs_review';
    }

    assignedColumns.add(candidate.sourceColumn);
    assignedFields.add(candidate.field.name);

    const evidence = buildEvidence(candidate.breakdown, candidate.field.name);

    mappings.push({
      sourceColumn: candidate.sourceColumn,
      canonicalField: candidate.field.name,
      confidence: candidate.confidence,
      evidence,
      status,
      candidates: (candidatesByField.get(candidate.field.name) ?? [])
        .slice()
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5),
      scoringBreakdown: candidate.breakdown,
    });
  }

  // ── Identify unmapped required fields ──────────────────────────────────────

  const unmappedRequired = table.fields
    .filter((f) => f.required && !assignedFields.has(f.name))
    .map((f) => f.name);

  // ── Compute table confidence ───────────────────────────────────────────────

  const requiredFields = table.fields.filter((f) => f.required);
  const requiredMappings = mappings.filter((m) =>
    requiredFields.some((f) => f.name === m.canonicalField),
  );

  const tableConfidence =
    requiredFields.length > 0
      ? requiredMappings.reduce((sum, m) => sum + m.confidence, 0) / requiredFields.length
      : 0;

  return {
    tableId: sheetRole.candidateRole,
    sourceSheet: sheetProfile.sheetName,
    headerRow: sheetProfile.headerRow,
    tableConfidence: Math.round(tableConfidence * 100) / 100,
    mappings,
    unmappedRequired,
    ambiguous: [...new Set(ambiguous)],
  };
}

// ── Evidence builder ─────────────────────────────────────────────────────────

function buildEvidence(breakdown: ColumnMapping['scoringBreakdown'], fieldName: string): string {
  const parts: string[] = [];
  if (breakdown.headerSimilarity >= 0.9) parts.push('header exact/synonym match');
  else if (breakdown.headerSimilarity >= 0.7) parts.push('header partial match');
  if (breakdown.valuePattern >= 0.8) parts.push('value pattern consistent');
  if (breakdown.dataType >= 0.8) parts.push('data type compatible');
  if (breakdown.sheetContext >= 0.8) parts.push('field belongs to this sheet type');
  if (breakdown.crossSheet >= 0.8) parts.push('values match master data');
  if (breakdown.llmSemantic >= 0.8) parts.push('llm semantic hint supports this match');
  if (breakdown.llmSemantic <= 0.2) parts.push('llm semantic hint strongly disagrees');

  return parts.length > 0
    ? `${fieldName}: ${parts.join(', ')}`
    : `${fieldName}: low confidence across all signals`;
}
