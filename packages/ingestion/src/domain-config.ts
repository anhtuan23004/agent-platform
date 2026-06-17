export type IngestionFieldDataType =
  | 'string'
  | 'number'
  | 'date'
  | 'percentage'
  | 'boolean'
  | 'enum';

export type DuplicatePolicy = 'allow' | 'skip' | 'block';

export interface IngestionFieldConfig {
  name: string;
  label: string;
  description: string;
  dataType: IngestionFieldDataType;
  required: boolean;
  synonyms: string[];
  valuePattern?: string;
}

export interface IngestionTableConfig {
  id: string;
  label: string;
  description: string;
  synonyms: string[];
  naturalKey: string[];
  duplicatePolicy: DuplicatePolicy;
  fields: IngestionFieldConfig[];
}

export interface IngestionReferenceRule {
  sourceTable: string;
  sourceField: string;
  targetTable: string;
  targetField: string;
  blocking: boolean;
  resolutionActions: Array<
    'add_missing_master' | 'map_to_existing' | 'exclude_rows' | 'reject_run'
  >;
}

export interface IngestionValidationRule {
  id: string;
  tableId: string;
  fieldName?: string;
  type: 'required' | 'range' | 'enum' | 'date_order' | 'custom';
  severity: 'info' | 'warning' | 'blocking';
  config: Record<string, unknown>;
}

export interface IngestionPublishPolicy {
  requireApproval: boolean;
  allowDirectPublish: boolean;
  mode: 'staged' | 'direct';
}

export interface IngestionDomainConfig {
  domainId: string;
  version: string;
  label: string;
  description?: string;
  tables: IngestionTableConfig[];
  referenceRules: IngestionReferenceRule[];
  validationRules: IngestionValidationRule[];
  publishPolicy: IngestionPublishPolicy;
}

export function getDomainTable(
  config: IngestionDomainConfig,
  tableId: string,
): IngestionTableConfig | undefined {
  return config.tables.find((table) => table.id === tableId);
}
