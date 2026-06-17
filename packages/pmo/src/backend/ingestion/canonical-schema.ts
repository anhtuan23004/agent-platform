// ── Canonical PMO Schema ─────────────────────────────────────────────────────
// Legacy types and helpers for scoring/mapping code that works with the
// CanonicalSchema format. The actual source of truth is now PMO_DOMAIN_CONFIG
// in pmo-domain-config.ts (and the JSON file at config/ingestion-domains/pmo/domain.json).
//
// PMO_CANONICAL_SCHEMA is derived from PMO_DOMAIN_CONFIG via the compat layer.
// New code should use IngestionDomainConfig / IngestionTableConfig / IngestionFieldConfig
// from domain-config.ts instead.

// Re-export types from the cycle-free canonical-types module.
export type { CanonicalField, CanonicalSchema, CanonicalTable } from './canonical-types.ts';

import type { CanonicalField, CanonicalSchema, CanonicalTable } from './canonical-types.ts';
import { PMO_DOMAIN_CANONICAL_SCHEMA } from './pmo-domain-config.ts';

// ── Derived constant ─────────────────────────────────────────────────────────
// PMO_CANONICAL_SCHEMA is now derived from PMO_DOMAIN_CONFIG (the new source of truth).

export const PMO_CANONICAL_SCHEMA: CanonicalSchema = PMO_DOMAIN_CANONICAL_SCHEMA;

// ── Helper functions ─────────────────────────────────────────────────────────

export function getCanonicalTable(tableId: string): CanonicalTable | undefined {
  return PMO_CANONICAL_SCHEMA.tables.find((t) => t.id === tableId);
}

export function getRequiredFields(tableId: string): CanonicalField[] {
  const table = getCanonicalTable(tableId);
  if (!table) return [];
  return table.fields.filter((f) => f.required);
}

export interface SynonymIndex {
  /** Maps normalized synonym → { tableId, fieldName } */
  entries: Map<string, Array<{ tableId: string; fieldName: string }>>;
}

export function buildSynonymIndex(schema: CanonicalSchema = PMO_CANONICAL_SCHEMA): SynonymIndex {
  const entries = new Map<string, Array<{ tableId: string; fieldName: string }>>();

  for (const table of schema.tables) {
    for (const field of table.fields) {
      const allTerms = [field.name, ...field.synonyms];
      for (const term of allTerms) {
        const normalized = normalizeTerm(term);
        const existing = entries.get(normalized) ?? [];
        existing.push({ tableId: table.id, fieldName: field.name });
        entries.set(normalized, existing);
      }
    }
  }

  return { entries };
}

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[_\-./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
