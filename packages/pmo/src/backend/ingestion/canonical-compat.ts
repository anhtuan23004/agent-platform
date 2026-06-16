import type { CanonicalSchema } from './canonical-types.ts';
import type { IngestionDomainConfig } from './domain-config.ts';

export function domainConfigToCanonicalSchema(config: IngestionDomainConfig): CanonicalSchema {
  return {
    version: config.version,
    tables: config.tables.map((table) => ({
      id: table.id,
      label: table.label,
      description: table.description,
      sheetNamePatterns: table.synonyms,
      fields: table.fields.map((field) => ({
        name: field.name,
        label: field.label,
        dataType: field.dataType,
        required: field.required,
        synonyms: field.synonyms,
        valuePattern: field.valuePattern,
        description: field.description,
      })),
    })),
  };
}
