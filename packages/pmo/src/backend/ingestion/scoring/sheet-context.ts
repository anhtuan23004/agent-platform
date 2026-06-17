import type { IngestionDomainConfig } from '@seta/ingestion';
import type { CanonicalField } from '../canonical-types.ts';
import type { SheetRoleCandidate } from '../detect-sheet-role.ts';
import { PMO_DOMAIN_CONFIG } from '../pmo-domain-config.ts';

// ── Build compatibility matrix from domain config ────────────────────────────
// Fields that belong to their own table get 1.0 (or 0.9 for non-core fields).
// Fields from other tables get low scores (0.1–0.3) based on whether they share
// an ID relationship (reference rules).

function buildFieldRoleCompatibility(
  domainConfig: IngestionDomainConfig,
): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};

  // Collect all reference-linked fields to know which IDs cross tables
  const referenceLinkedFields = new Set<string>();
  for (const rule of domainConfig.referenceRules) {
    referenceLinkedFields.add(rule.sourceField);
    referenceLinkedFields.add(rule.targetField);
  }

  // Collect all field names across all tables so we can identify cross-table fields
  const fieldOwnership = new Map<string, Set<string>>(); // fieldName -> set of owning tableIds
  for (const table of domainConfig.tables) {
    for (const field of table.fields) {
      const owners = fieldOwnership.get(field.name) ?? new Set();
      owners.add(table.id);
      fieldOwnership.set(field.name, owners);
    }
  }

  for (const table of domainConfig.tables) {
    const tableScores: Record<string, number> = {};
    const ownFieldNames = new Set(table.fields.map((f) => f.name));

    // Own fields get high scores
    for (const field of table.fields) {
      if (field.required) {
        tableScores[field.name] = 1.0;
      } else {
        tableScores[field.name] =
          field.dataType === 'string' && !field.name.endsWith('_id') ? 0.8 : 1.0;
      }
    }

    // Penalize fields that belong to other tables but not this one.
    // Fields not defined in ANY table remain at DEFAULT_COMPATIBILITY (0.5).
    for (const [fieldName] of fieldOwnership) {
      if (ownFieldNames.has(fieldName)) continue; // already scored as own field

      // This field belongs to at least one other table but NOT this one → penalize
      if (referenceLinkedFields.has(fieldName)) {
        // Reference-linked ID fields can legitimately appear cross-table → mild penalty
        tableScores[fieldName] = 0.3;
      } else {
        // Fields clearly from another domain → strong penalty
        tableScores[fieldName] = 0.1;
      }
    }

    matrix[table.id] = tableScores;
  }

  return matrix;
}

// Default compatibility when field is not explicitly listed for a role
const DEFAULT_COMPATIBILITY = 0.5;

// Cached matrix per config version
let cachedMatrix: Record<string, Record<string, number>> | null = null;
let cachedConfigVersion: string | null = null;

function getFieldRoleCompatibility(
  domainConfig: IngestionDomainConfig,
): Record<string, Record<string, number>> {
  const key = `${domainConfig.domainId}:${domainConfig.version}`;
  if (cachedMatrix && cachedConfigVersion === key) return cachedMatrix;
  cachedMatrix = buildFieldRoleCompatibility(domainConfig);
  cachedConfigVersion = key;
  return cachedMatrix;
}

// ── Main scorer ──────────────────────────────────────────────────────────────

export function scoreSheetContext(
  sheetRole: SheetRoleCandidate,
  canonicalField: CanonicalField,
  domainConfig: IngestionDomainConfig = PMO_DOMAIN_CONFIG,
): number {
  const matrix = getFieldRoleCompatibility(domainConfig);
  const roleMatrix = matrix[sheetRole.candidateRole];
  const fieldCompatibility = roleMatrix?.[canonicalField.name] ?? DEFAULT_COMPATIBILITY;

  // Final score = sheet role confidence × field compatibility
  return Math.round(sheetRole.confidence * fieldCompatibility * 100) / 100;
}
