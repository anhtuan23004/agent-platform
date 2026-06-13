import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { SessionEnv } from '@seta/core';
import { buildTenantKey, getS3Client, presignedUploadUrl } from '@seta/shared-storage';
import { Hono } from 'hono';
import { z } from 'zod';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';

// ── Types ────────────────────────────────────────────────────────────────────

const UploadRequestSchema = z.object({
  filename: z.string().min(1),
  mime_type: z
    .string()
    .default('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  reporting_period_key: z.string().optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export function buildPmoRoutes(): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  // POST /api/pmo/v1/upload-url
  // Returns a presigned S3 URL for the client to upload the Excel file,
  // plus an ingestion_session_id to track the upload.
  app.post('/api/pmo/v1/upload-url', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = UploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { filename, mime_type, reporting_period_key } = parsed.data;
    const sessionId = crypto.randomUUID();

    // Build S3 key
    const s3Key = buildTenantKey({
      tenant_id: session.tenant_id,
      domain: 'pmo',
      file_id: sessionId,
      filename,
    });

    // Insert ingestion session
    const db = pmoDb();
    await db.insert(ingestionSessions).values({
      id: sessionId,
      tenant_id: session.tenant_id,
      status: 'uploaded',
      source_file_key: s3Key,
      source_file_name: filename,
      mime_type,
      reporting_period_key: reporting_period_key ?? null,
      created_by: session.user_id,
    });

    // Generate presigned upload URL
    const bucket = process.env.S3_BUCKET ?? 'seta-uploads';
    const upload_url = await presignedUploadUrl({
      bucket,
      key: s3Key,
      contentType: mime_type,
      expiresInSeconds: 15 * 60,
    });

    return c.json({
      ingestion_session_id: sessionId,
      upload_url,
      s3_key: s3Key,
      filename,
    });
  });

  // POST /api/pmo/v1/upload-complete
  // Called after client uploads file to S3. Starts the ingest workflow.
  app.post('/api/pmo/v1/upload-complete', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { ingestion_session_id } = body as { ingestion_session_id?: string };

    if (!ingestion_session_id) {
      return c.json({ error: 'ingestion_session_id required' }, 400);
    }

    // TODO: Start pmo.ingestData workflow via Mastra
    return c.json({
      status: 'workflow_started',
      ingestion_session_id,
      message: 'Schema inference workflow has been queued.',
    });
  });

  // POST /api/pmo/v1/upload
  // Proxy upload: client sends file as multipart, server uploads to S3.
  // Bypasses CORS issues with direct-to-S3 presigned URLs.
  app.post('/api/pmo/v1/upload', async (c) => {
    const session = c.get('user');
    const body = await c.req.parseBody();
    const file = body.file;

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'file field required (multipart)' }, 400);
    }

    const filename = file.name || 'upload.xlsx';
    const reportingPeriodKey = (body.reporting_period_key as string) || undefined;
    const sessionId = crypto.randomUUID();
    const mime_type =
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Build S3 key
    const s3Key = buildTenantKey({
      tenant_id: session.tenant_id,
      domain: 'pmo',
      file_id: sessionId,
      filename,
    });

    // Upload to S3
    const bucket = process.env.S3_BUCKET ?? 'seta-uploads';
    const s3 = getS3Client();
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: mime_type,
      }),
    );

    // Insert ingestion session
    const db = pmoDb();
    await db.insert(ingestionSessions).values({
      id: sessionId,
      tenant_id: session.tenant_id,
      status: 'uploaded',
      source_file_key: s3Key,
      source_file_name: filename,
      mime_type,
      reporting_period_key: reportingPeriodKey ?? null,
      created_by: session.user_id,
    });

    // TODO: Start pmo.ingestData workflow via Mastra
    return c.json({
      ingestion_session_id: sessionId,
      s3_key: s3Key,
      status: 'uploaded',
      message: 'File uploaded. Schema inference workflow queued.',
    });
  });

  return app;
}
