import type { IngestionDomainAdapter, IngestionDomainConfig } from '@seta/ingestion';
import type { z } from 'zod';
import type { SchemaDetectionResult } from '../../../ingestion/detect-schema.ts';
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

export interface ProfilingResult {
  tableMappings: DetectTableMapping[];
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  workbookConfidence: number;
}

export interface DbChangeSummaryResult {
  changeSummary: StagingChangeSummary;
  blockingIssues: BlockingIssue[];
  mappingReviewRows: MappingReviewRow[];
  hasBlockingIssues: boolean;
  hasUpdates: boolean;
  requiresReview: boolean;
}

export interface NormalizationResult extends DbChangeSummaryResult {
  rowCountsByTable: Record<string, number>;
  duplicateInUploadRows: Array<{
    tableId: string;
    naturalKey: Record<string, string>;
    sourceRow: number;
    policy: 'allow' | 'skip' | 'block';
  }>;
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
