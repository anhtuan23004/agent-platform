import type { ActiveRecord } from './stage-changes.ts';

export interface IngestionPublishResult {
  rowsWritten: Record<string, number>;
  rowsUpdated: Record<string, number>;
  rowsSkipped: Record<string, number>;
}

export interface IngestionDomainAdapter {
  domainId: string;

  findReferenceValues(input: {
    tenantId: string;
    tableId: string;
    fieldName: string;
  }): Promise<Set<string>>;

  findActiveRecords(input: { tenantId: string; tableId: string }): Promise<ActiveRecord[]>;

  publish(input: { tenantId: string; ingestionSessionId: string }): Promise<IngestionPublishResult>;
}
