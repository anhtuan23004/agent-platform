import type { z } from 'zod';
import type { SchemaDetectionResult } from '../../../ingestion/detect-schema.ts';
import type { IngestionDomainAdapter } from '../../../ingestion/domain-adapter.ts';
import type { IngestionDomainConfig } from '../../../ingestion/domain-config.ts';
import type { WorkbookParseResult } from '../../../ingestion/parse-workbook.ts';
import type { PmoPlannerStepMetadata } from '../../../planning/step-metadata.ts';
import type { MappingOverride } from '../cards.ts';
import type { ConfirmOutputSchema, DetectOutputSchema, StagingOutputSchema } from '../schemas.ts';
import type { PlannerExecutionStepV2, PmoDynamicHandlerInput } from '../types.ts';

export type DetectTableMapping = z.infer<typeof DetectOutputSchema>['tableMappings'][number];
export type MappingReviewRow = z.infer<typeof ConfirmOutputSchema>['mappingReviewRows'][number];
export type BlockingIssue = z.infer<typeof StagingOutputSchema>['blockingIssues'][number];
export type StagingChangeSummary = z.infer<typeof StagingOutputSchema>['changeSummary'];

export interface MappingResult {
  confirmedMappings: DetectTableMapping[];
  mappingReviewRows: MappingReviewRow[];
}

export interface DynamicHandlerDeps {
  domainConfig: IngestionDomainConfig;
  domainAdapter: IngestionDomainAdapter;
  resolveCardIdentity(requestContext: { get: (key: string) => unknown }): {
    tenantId: string;
    userId: string;
  };
  readPlannerStepMeta(params: {
    ingestionSessionId: string;
    tenantId: string;
    step: PlannerExecutionStepV2;
  }): Promise<PmoPlannerStepMetadata | null>;
  applyMappingOverrides(
    tableMappings: DetectTableMapping[],
    mappingOverrides: MappingOverride[],
  ): DetectTableMapping[];
  requiredFieldsByTable: ReadonlyMap<string, string[]>;
  getWorkbookParseResult(input: PmoDynamicHandlerInput): Promise<WorkbookParseResult>;
  getSchemaDetectionResult(input: PmoDynamicHandlerInput): Promise<SchemaDetectionResult>;
}
