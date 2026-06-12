import { PMO_CANONICAL_SCHEMA } from './canonical-schema.ts';
import { detectSheetRoles } from './detect-sheet-role.ts';
import type { TableMapping } from './map-columns.ts';
import { mapColumns } from './map-columns.ts';
import { parseWorkbook } from './parse-workbook.ts';
import { profileColumns } from './profile-columns.ts';
import { type MappingValidationResult, validateMapping } from './validate-mapping.ts';

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

// ── Main orchestration function ──────────────────────────────────────────────

export async function detectSchema(
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<SchemaDetectionResult> {
  // 1. Parse workbook → sheets with full rows
  const parseResult = await parseWorkbook(fileBuffer);

  // 2. Profile each sheet's columns
  const profiles = parseResult.sheets.map((sheet) => profileColumns(sheet));

  // 3. Detect sheet roles
  const roleDetections = detectSheetRoles(profiles, PMO_CANONICAL_SCHEMA);

  // 4. Map columns for each sheet with a detected role
  const allProfiles = profiles;
  const tableMappings: TableMapping[] = [];

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const roleDetection = roleDetections[i];

    if (!profile || !roleDetection?.topCandidate) continue;

    const mapping = mapColumns(
      profile,
      roleDetection.topCandidate,
      allProfiles,
      PMO_CANONICAL_SCHEMA,
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
