import { createHash } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { buildTenantKey, getS3Client } from '@seta/shared-storage';

export interface ReportArtifact {
  s3Key: string;
  sha256: string;
  sizeBytes: number;
}

export function buildReportArtifactKey(
  tenantId: string,
  reportRunId: string,
  filename: 'report.html' | 'report.pdf',
): string {
  return buildTenantKey({
    tenant_id: tenantId,
    domain: 'pmo',
    file_id: `reports/${reportRunId}`,
    filename,
  });
}

export async function uploadPrivateReportArtifact(input: {
  tenantId: string;
  reportRunId: string;
  filename: 'report.html' | 'report.pdf';
  contentType: 'text/html; charset=utf-8' | 'application/pdf';
  bytes: Uint8Array;
  s3?: S3Client;
  bucket?: string;
}): Promise<ReportArtifact> {
  const bucket = input.bucket ?? process.env.PMO_REPORT_S3_BUCKET ?? process.env.S3_BUCKET;
  if (!bucket) throw new Error('pmo_report_s3_bucket_required');
  const s3Key = buildReportArtifactKey(input.tenantId, input.reportRunId, input.filename);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  await (input.s3 ?? getS3Client()).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: input.bytes,
      ContentType: input.contentType,
      CacheControl: 'private, no-store',
      Metadata: { sha256, report_run_id: input.reportRunId },
    }),
  );
  return { s3Key, sha256, sizeBytes: input.bytes.byteLength };
}
