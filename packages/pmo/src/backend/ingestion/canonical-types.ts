// ── Canonical Schema Types ───────────────────────────────────────────────────
// Pure type definitions for the CanonicalSchema format used by scoring modules.
// Kept in a separate file to avoid circular dependencies between
// canonical-schema.ts, pmo-domain-config.ts, and canonical-compat.ts.

export interface CanonicalField {
  name: string;
  label: string;
  dataType: 'string' | 'number' | 'date' | 'percentage' | 'boolean' | 'enum';
  required: boolean;
  synonyms: string[];
  valuePattern?: string;
  description: string;
}

export interface CanonicalTable {
  id: string;
  label: string;
  sheetNamePatterns: string[];
  fields: CanonicalField[];
  description: string;
}

export interface CanonicalSchema {
  version: string;
  tables: CanonicalTable[];
}
