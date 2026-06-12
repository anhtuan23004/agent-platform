import type { TableMapping } from './map-columns.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  tableId: string;
  field: string | null;
  code: string;
  message: string;
}

export interface MappingValidationResult {
  status: 'confirmed' | 'needs_review' | 'blocked';
  issues: ValidationIssue[];
  workbookConfidence: number;
}

// ── Core tables that must be present ─────────────────────────────────────────

const CORE_TABLES = new Set(['resource_allocation', 'timesheet']);

// ── Main function ────────────────────────────────────────────────────────────

export function validateMapping(tableMappings: TableMapping[]): MappingValidationResult {
  const issues: ValidationIssue[] = [];
  let overallStatus: MappingValidationResult['status'] = 'confirmed';

  for (const table of tableMappings) {
    // Check unmapped required fields
    for (const field of table.unmappedRequired) {
      issues.push({
        severity: 'error',
        tableId: table.tableId,
        field,
        code: 'MISSING_REQUIRED',
        message: `Required field '${field}' has no matching column in sheet '${table.sourceSheet}'.`,
      });
      overallStatus = 'blocked';
    }

    // Check blocked mappings
    for (const mapping of table.mappings) {
      if (mapping.status === 'blocked') {
        issues.push({
          severity: 'error',
          tableId: table.tableId,
          field: mapping.canonicalField,
          code: 'TYPE_MISMATCH',
          message: `Column '${mapping.sourceColumn}' mapped to '${mapping.canonicalField}' has incompatible data type.`,
        });
        overallStatus = 'blocked';
      }
    }

    // Check needs_review mappings
    for (const mapping of table.mappings) {
      if (mapping.status === 'needs_review') {
        issues.push({
          severity: 'warning',
          tableId: table.tableId,
          field: mapping.canonicalField,
          code: 'LOW_CONFIDENCE',
          message: `Column '${mapping.sourceColumn}' → '${mapping.canonicalField}' has confidence ${mapping.confidence.toFixed(2)} and may need confirmation.`,
        });
        if (overallStatus === 'confirmed') {
          overallStatus = 'needs_review';
        }
      }
    }

    // Check ambiguous fields
    for (const field of table.ambiguous) {
      issues.push({
        severity: 'warning',
        tableId: table.tableId,
        field,
        code: 'AMBIGUOUS_MAPPING',
        message: `Field '${field}' has multiple candidate columns with similar scores.`,
      });
      if (overallStatus === 'confirmed') {
        overallStatus = 'needs_review';
      }
    }

    // Low table confidence
    if (table.tableConfidence < 0.7 && table.tableConfidence > 0) {
      issues.push({
        severity: 'warning',
        tableId: table.tableId,
        field: null,
        code: 'LOW_TABLE_CONFIDENCE',
        message: `Table '${table.tableId}' has overall confidence ${table.tableConfidence.toFixed(2)}.`,
      });
      if (overallStatus === 'confirmed') {
        overallStatus = 'needs_review';
      }
    }
  }

  // Check if core tables (RA, Timesheet) are present and not blocked
  const mappedTableIds = new Set(tableMappings.map((t) => t.tableId));
  for (const coreTable of CORE_TABLES) {
    if (!mappedTableIds.has(coreTable)) {
      issues.push({
        severity: 'warning',
        tableId: coreTable,
        field: null,
        code: 'CORE_TABLE_MISSING',
        message: `Core table '${coreTable}' was not detected in the workbook.`,
      });
      if (overallStatus === 'confirmed') {
        overallStatus = 'needs_review';
      }
    }
  }

  // Compute workbook confidence (weighted average of table confidences)
  const totalConfidence = tableMappings.reduce((sum, t) => sum + t.tableConfidence, 0);
  const workbookConfidence =
    tableMappings.length > 0 ? Math.round((totalConfidence / tableMappings.length) * 100) / 100 : 0;

  return { status: overallStatus, issues, workbookConfidence };
}
