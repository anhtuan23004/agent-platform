import type { SessionEnv } from '@seta/core';
import type { Hono } from 'hono';
import { z } from 'zod';

import { DemoAnalyticsNoDataError, runDemoAnalytics } from '../analytics/demo-analytics.ts';
import { ensureFactsComputed } from '../analytics/ensure-facts-computed.ts';

const ComputeFactsRequestSchema = z.object({
  ingestion_session_id: z.string().uuid().optional(),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DemoAnalyticsQuerySchema = z
  .object({
    from: dateString.optional(),
    to: dateString.optional(),
    configEffectiveDate: dateString.optional(),
    ingestion_session_id: z.string().uuid().optional(),
    overbookThreshold: z.coerce.number().min(0).max(5).optional(),
    overbookRedThreshold: z.coerce.number().min(0).max(5).optional(),
    idleThreshold: z.coerce.number().min(0).max(5).optional(),
    mismatchPctThreshold: z.coerce.number().min(0).max(5).optional(),
  })
  .refine((q) => (q.from && q.to) || (!q.from && !q.to), {
    message: 'from and to must be provided together',
    path: ['from'],
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must be before or equal to to',
    path: ['from'],
  })
  .refine((q) => !q.from || !q.configEffectiveDate || q.configEffectiveDate <= q.from, {
    message: 'configEffectiveDate must be before or equal to from',
    path: ['configEffectiveDate'],
  });

function dateFromQuery(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** PMO utilization analytics HTTP routes (calculation demo UI). */
export function registerDemoAnalyticsRoutes(app: Hono<SessionEnv>): void {
  app.get('/api/pmo/v1/demo-analytics', async (c) => {
    const session = c.get('user');
    const parsed = DemoAnalyticsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    const q = parsed.data;
    try {
      const result = await runDemoAnalytics(session.tenant_id, {
        dateRange:
          q.from && q.to
            ? {
                from: dateFromQuery(q.from),
                to: dateFromQuery(q.to),
              }
            : undefined,
        configEffectiveDate: q.configEffectiveDate
          ? dateFromQuery(q.configEffectiveDate)
          : undefined,
        ingestionSessionId: q.ingestion_session_id,
        thresholdOverrides: {
          overbookThreshold: q.overbookThreshold,
          overbookRedThreshold: q.overbookRedThreshold,
          idleThreshold: q.idleThreshold,
          mismatchPctThreshold: q.mismatchPctThreshold,
        },
      });
      return c.json(result);
    } catch (err: unknown) {
      if (err instanceof DemoAnalyticsNoDataError) {
        return c.json({ error: 'no_data', message: err.message }, 404);
      }
      throw err;
    }
  });

  app.post('/api/pmo/v1/analytics/compute-facts', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ComputeFactsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    try {
      const result = await ensureFactsComputed(session.tenant_id, {
        sessionId: parsed.data.ingestion_session_id,
        force: true,
      });
      return c.json({
        factCount: result.factCount,
        memberCount: result.memberCount,
        weekIds: result.weekIds,
        computedAt: result.computedAt.toISOString(),
        ingestionSessionId: result.ingestionSessionId,
        recomputed: result.recomputed,
      });
    } catch (err: unknown) {
      if (err instanceof DemoAnalyticsNoDataError) {
        return c.json({ error: 'no_data', message: err.message }, 404);
      }
      throw err;
    }
  });
}
