import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SessionEnv } from '@seta/core';
import { buildTenantKey, presignedUploadUrl } from '@seta/shared-storage';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';
import { generatePmoWorkflowPlan } from '../planning/generate-plan.ts';

type PlanningState = 'uploaded' | 'generating_plan' | 'plan_review' | 'approved_plan';

function asIso(input: Date | string | null | undefined): string {
  if (!input) {
    return new Date().toISOString();
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function formatFileSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) {
    return '0 B';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readPlanningState(rawStatus: string): PlanningState {
  if (rawStatus === 'uploaded') return 'uploaded';
  if (rawStatus === 'approved_plan') return 'approved_plan';
  if (rawStatus === 'plan_review') return 'plan_review';
  if (rawStatus === 'generating_plan') return 'generating_plan';
  // Any non-planning runtime status is already beyond plan generation.
  return 'approved_plan';
}

function mapHistoryStatus(state: PlanningState): {
  label: string;
  active_gate: string;
  progress_text: string;
  progress_pct: number;
} {
  if (state === 'uploaded') {
    return {
      label: 'Uploaded',
      active_gate: 'Analyze and generate plan',
      progress_text: '0 / 3 (0%)',
      progress_pct: 0,
    };
  }

  if (state === 'generating_plan') {
    return {
      label: 'Generating plan',
      active_gate: 'Analyze and generate plan',
      progress_text: '1 / 3 (33%)',
      progress_pct: 33,
    };
  }

  if (state === 'plan_review') {
    return {
      label: 'Plan review',
      active_gate: 'Plan review',
      progress_text: '2 / 3 (67%)',
      progress_pct: 67,
    };
  }

  return {
    label: 'Approved',
    active_gate: 'Approved and moved next step',
    progress_text: '3 / 3 (100%)',
    progress_pct: 100,
  };
}

const PlanGenerateRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
  goal: z.string().trim().min(1).max(4000),
  plan_feedback: z.string().trim().max(4000).optional(),
  previous_plan: z.unknown().optional(),
});

const PlanApproveRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
});

// ── Types ────────────────────────────────────────────────────────────────────

const UploadRequestSchema = z.object({
  filename: z.string().min(1),
  file_size_bytes: z.number().int().nonnegative().optional(),
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

    const { filename, file_size_bytes, mime_type, reporting_period_key } = parsed.data;
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
      source_file_size_bytes: file_size_bytes ?? null,
      mime_type,
      reporting_period_key: reporting_period_key ?? null,
      created_by: session.user_id,
    });

    // Generate presigned upload URL
    const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
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
  // Called after client uploads file to S3. Returns canonical payload to start
  // pmo.ingestData via /api/agent/v1/workflows/runs/pmo.ingestData/start.
  app.post('/api/pmo/v1/upload-complete', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { ingestion_session_id } = body as { ingestion_session_id?: string };

    if (!ingestion_session_id) {
      return c.json({ error: 'ingestion_session_id required' }, 400);
    }

    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_key: ingestionSessions.source_file_key,
        reporting_period_key: ingestionSessions.reporting_period_key,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    return c.json({
      status: 'uploaded',
      ingestion_session_id: row.id,
      file_key: row.source_file_key,
      reporting_period_key: row.reporting_period_key,
      start_payload: {
        ingestionSessionId: row.id,
        fileKey: row.source_file_key,
        reportingPeriodKey: row.reporting_period_key ?? undefined,
      },
      message:
        'Upload recorded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
    });
  });

  // POST /api/pmo/v1/upload
  // Proxy upload: client sends file as multipart, server uploads to S3.
  // Bypasses CORS issues with direct-to-S3 presigned URLs.
  app.post('/api/pmo/v1/upload', async (c) => {
    try {
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
      const sizeBytes = Number.isFinite(file.size) ? file.size : null;

      // Build S3 key
      const s3Key = buildTenantKey({
        tenant_id: session.tenant_id,
        domain: 'pmo',
        file_id: sessionId,
        filename,
      });

      // Upload to S3
      const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
      const region = process.env.S3_REGION ?? 'ap-southeast-1';
      const s3 = new S3Client({ region });
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
        source_file_size_bytes: sizeBytes,
        mime_type,
        reporting_period_key: reportingPeriodKey ?? null,
        created_by: session.user_id,
      });

      return c.json({
        ingestion_session_id: sessionId,
        s3_key: s3Key,
        status: 'uploaded',
        start_payload: {
          ingestionSessionId: sessionId,
          fileKey: s3Key,
          reportingPeriodKey: reportingPeriodKey,
        },
        message:
          'File uploaded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[pmo/upload] error:', message, err);
      return c.json({ error: 'upload_failed', message }, 500);
    }
  });

  // GET /api/pmo/v1/ingestion-sessions
  // Returns latest sessions with planning status for frontend history and resume.
  app.get('/api/pmo/v1/ingestion-sessions', async (c) => {
    const session = c.get('user');
    const db = pmoDb();

    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_name: ingestionSessions.source_file_name,
        source_file_size_bytes: ingestionSessions.source_file_size_bytes,
        mime_type: ingestionSessions.mime_type,
        status: ingestionSessions.status,
        planning_goal: ingestionSessions.planning_goal,
        planning_plan: ingestionSessions.planning_plan,
        planning_plan_version: ingestionSessions.planning_plan_version,
        planning_feedback_history: ingestionSessions.planning_feedback_history,
        created_by: ingestionSessions.created_by,
        created_at: ingestionSessions.created_at,
        planning_last_generated_at: ingestionSessions.planning_last_generated_at,
        planning_approved_at: ingestionSessions.planning_approved_at,
      })
      .from(ingestionSessions)
      .where(eq(ingestionSessions.tenant_id, session.tenant_id))
      .orderBy(ingestionSessions.created_at)
      .limit(100);

    const mapped = rows
      .slice()
      .reverse()
      .map((row) => {
        const planningState = readPlanningState(row.status);
        const history = mapHistoryStatus(planningState);

        return {
          ingestion_session_id: row.id,
          workbook_name: row.source_file_name,
          workbook_size_bytes: row.source_file_size_bytes ?? 0,
          workbook_size: formatFileSize(row.source_file_size_bytes ?? 0),
          file_type: row.mime_type,
          uploaded_at: asIso(row.created_at),
          operator: row.created_by,
          planning_state: planningState,
          status_label: history.label,
          active_gate: history.active_gate,
          progress_text: history.progress_text,
          progress_pct: history.progress_pct,
          goal: row.planning_goal ?? '',
          plan: row.planning_plan,
          plan_version: row.planning_plan_version ?? 0,
          feedback_history: Array.isArray(row.planning_feedback_history)
            ? row.planning_feedback_history
            : [],
          plan_generated_at: row.planning_last_generated_at
            ? asIso(row.planning_last_generated_at)
            : null,
          plan_approved_at: row.planning_approved_at ? asIso(row.planning_approved_at) : null,
        };
      });

    return c.json({ items: mapped });
  });

  // POST /api/pmo/v1/plan/generate
  // Generates or regenerates a planning draft using Goal + file metadata.
  app.post('/api/pmo/v1/plan/generate', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = PlanGenerateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id, goal, previous_plan, plan_feedback } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        source_file_name: ingestionSessions.source_file_name,
        source_file_size_bytes: ingestionSessions.source_file_size_bytes,
        mime_type: ingestionSessions.mime_type,
        created_at: ingestionSessions.created_at,
        status: ingestionSessions.status,
        planning_plan_version: ingestionSessions.planning_plan_version,
        planning_feedback_history: ingestionSessions.planning_feedback_history,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const currentState = readPlanningState(row.status);
    if (currentState === 'approved_plan') {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Approved plan cannot be regenerated in this phase.',
        },
        409,
      );
    }

    await db
      .update(ingestionSessions)
      .set({
        status: 'generating_plan',
        planning_goal: goal,
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    const effectiveFeedback = plan_feedback?.trim() || '';
    const effectivePreviousPlan = previous_plan ?? null;

    try {
      const plan = await generatePmoWorkflowPlan({
        goal,
        uploaded_file: {
          file_name: row.source_file_name,
          file_size: formatFileSize(row.source_file_size_bytes ?? 0),
          uploaded_at: asIso(row.created_at),
          file_type: row.mime_type,
        },
        workflow_capabilities: {
          can_parse_excel_workbook: true,
          can_detect_sheet_roles: true,
          can_propose_column_mappings: true,
          can_normalize_to_staging: true,
          can_compare_with_existing_database: true,
          can_generate_db_change_summary: true,
          can_publish_after_user_approval: true,
        },
        previous_plan: effectivePreviousPlan,
        ...(effectiveFeedback ? { plan_feedback: effectiveFeedback } : {}),
      });

      const existingFeedback = Array.isArray(row.planning_feedback_history)
        ? row.planning_feedback_history
        : [];
      const nextFeedback = effectiveFeedback
        ? [...existingFeedback, effectiveFeedback]
        : existingFeedback;
      const nextVersion = (row.planning_plan_version ?? 0) + 1;

      await db
        .update(ingestionSessions)
        .set({
          status: 'plan_review',
          planning_goal: goal,
          planning_plan: plan,
          planning_plan_version: nextVersion,
          planning_feedback_history: nextFeedback,
          planning_last_generated_at: new Date(),
        })
        .where(
          and(
            eq(ingestionSessions.id, ingestion_session_id),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        );

      return c.json({
        ingestion_session_id,
        planning_state: 'plan_review' as const,
        plan,
        plan_version: nextVersion,
        feedback_history: nextFeedback,
      });
    } catch (err) {
      await db
        .update(ingestionSessions)
        .set({
          status: currentState,
        })
        .where(
          and(
            eq(ingestionSessions.id, ingestion_session_id),
            eq(ingestionSessions.tenant_id, session.tenant_id),
          ),
        );

      const message = err instanceof Error ? err.message : String(err);
      console.error('[pmo/plan/generate] error:', message, err);
      return c.json({ error: 'plan_generation_failed', message }, 500);
    }
  });

  // POST /api/pmo/v1/plan/approve
  // Approves current plan and moves to next workflow step marker.
  app.post('/api/pmo/v1/plan/approve', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = PlanApproveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const { ingestion_session_id } = parsed.data;
    const db = pmoDb();
    const rows = await db
      .select({
        id: ingestionSessions.id,
        status: ingestionSessions.status,
        planning_plan: ingestionSessions.planning_plan,
      })
      .from(ingestionSessions)
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    const state = readPlanningState(row.status);
    if (state !== 'plan_review') {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Only plan_review state can be approved.',
        },
        409,
      );
    }

    if (!row.planning_plan) {
      return c.json(
        {
          error: 'invalid_state',
          message: 'Cannot approve before a plan exists.',
        },
        409,
      );
    }

    await db
      .update(ingestionSessions)
      .set({
        status: 'approved_plan',
        planning_approved_at: new Date(),
      })
      .where(
        and(
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      );

    return c.json({
      ingestion_session_id,
      planning_state: 'approved_plan' as const,
      approved_at: new Date().toISOString(),
    });
  });

  return app;
}
