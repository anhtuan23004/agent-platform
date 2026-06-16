import { PMO_CANONICAL_SCHEMA } from './canonical-schema.ts';
import { detectSheetRoles } from './detect-sheet-role.ts';
import { maybeInferLlmMappingHints } from './llm-mapping-hints.ts';
import type { TableMapping } from './map-columns.ts';
import { mapColumns } from './map-columns.ts';
import { parseWorkbook } from './parse-workbook.ts';
import { profileColumns } from './profile-columns.ts';
import { type MappingValidationResult, validateMapping } from './validate-mapping.ts';

function resolveLlmBonusWeight(): number {
  const raw = Number.parseFloat(process.env.PMO_MAPPING_LLM_BONUS_WEIGHT ?? '0.06');
  if (!Number.isFinite(raw)) return 0.06;
  if (raw <= 0) return 0;
  if (raw >= 0.2) return 0.2;
  return raw;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface SchemaDetectionResult {
  tables: TableMapping[];
  validation: MappingValidationResult;
  workbookMeta: {
    sheetCount: number;
    excludedSheets: string[];
    totalRows: number;
  };
}

export interface DetectSchemaOptions {
  parsedWorkbook?: Awaited<ReturnType<typeof parseWorkbook>>;
}

// ── Main orchestration function ──────────────────────────────────────────────

export async function detectSchema(
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  options?: DetectSchemaOptions,
): Promise<SchemaDetectionResult> {
  // 1. Parse workbook → sheets with full rows
  const parseResult = options?.parsedWorkbook ?? (await parseWorkbook(fileBuffer));

  // 2. Profile each sheet's columns
  const profiles = parseResult.sheets.map((sheet) => profileColumns(sheet));

  // 3. Detect sheet roles
  const roleDetections = detectSheetRoles(profiles, PMO_CANONICAL_SCHEMA);

  // 4. Map columns for each sheet with a detected role
  const allProfiles = profiles;
  const tableMappings: TableMapping[] = [];
  const llmBonusWeight = resolveLlmBonusWeight();

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const roleDetection = roleDetections[i];

    if (!profile || !roleDetection?.topCandidate) continue;

    const targetTable = PMO_CANONICAL_SCHEMA.tables.find(
      (table) => table.id === roleDetection.topCandidate?.candidateRole,
    );
    const llmHints = targetTable
      ? await maybeInferLlmMappingHints({ sheetProfile: profile, table: targetTable })
      : null;

    const mapping = mapColumns(
      profile,
      roleDetection.topCandidate,
      allProfiles,
      PMO_CANONICAL_SCHEMA,
      { llmHints, llmBonusWeight },
    );
    tableMappings.push(mapping);
  }

  // 5. Validate all mappings
  const validation = validateMapping(tableMappings);

  // 6. Compute metadata
  const totalRows = parseResult.sheets.reduce((sum, s) => sum + s.rowCount, 0);

  return {
    tables: tableMappings,
    validation,
    workbookMeta: {
      sheetCount: parseResult.sheets.length,
      excludedSheets: parseResult.excludedSheets,
      totalRows,
    },
  };
}
