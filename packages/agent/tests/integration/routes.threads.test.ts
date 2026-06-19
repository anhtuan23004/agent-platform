import { createTestTenantWithAdmin } from '@seta/identity/testing';
import type { OrchestrationEvent } from '@seta/shared-orchestration';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerAgentRoutes } from '../../src/backend/routes.ts';
import { buildMastra } from '../../src/backend/runtime.ts';
import { withAgentTestDb } from '../helpers.ts';

type TestSession = {
  tenant_id: string;
  user_id: string;
  effective_permissions: ReadonlySet<string>;
  role_summary: { roles: string[]; cross_tenant_read: boolean };
};

async function* stubOrchestration(): AsyncIterable<OrchestrationEvent> {
  yield { kind: 'final', result: { message: 'ok' } };
}

type StorageWithStores = {
  stores: {
    memory: {
      saveThread: (args: {
        thread: {
          id: string;
          resourceId: string;
          title?: string;
          createdAt: Date;
          updatedAt: Date;
          metadata?: Record<string, unknown>;
        };
      }) => Promise<unknown>;
    };
  };
};

async function seedThread(
  storage: unknown,
  thread: {
    id: string;
    resourceId: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  await (storage as StorageWithStores).stores.memory.saveThread({
    thread: {
      id: thread.id,
      resourceId: thread.resourceId,
      title: thread.title,
      createdAt: now,
      updatedAt: now,
      metadata: thread.metadata ?? {},
    },
  });
}

function makeApp(args: {
  tenant_id: string;
  user_id: string;
  permissions?: string[];
  mastra: unknown;
  pool: import('pg').Pool;
}) {
  const app = new Hono<{ Variables: { session: TestSession } }>();
  app.use('*', async (c, next) => {
    c.set('session', {
      tenant_id: args.tenant_id,
      user_id: args.user_id,
      effective_permissions: new Set(
        args.permissions ?? ['agent.chat.use', 'agent.thread.read.self', 'agent.thread.write.self'],
      ),
      role_summary: { roles: ['org.admin'], cross_tenant_read: false },
    });
    await next();
  });
  registerAgentRoutes(app, {
    chatOrchestration: () => stubOrchestration(),
    mastra: args.mastra as never,
    pool: args.pool,
  });
  return app;
}

describe('threads routes', () => {
  it('GET /threads returns empty list initially', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const { admin_user_id, tenant_id } = await createTestTenantWithAdmin({ pool });
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      const app = makeApp({ tenant_id, user_id: admin_user_id, mastra, pool });
      const res = await app.request('/api/agent/v1/threads');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { threads: unknown[] };
      expect(body.threads).toEqual([]);
    });
  });

  it('GET /threads can filter history by chat agent', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const { admin_user_id, tenant_id } = await createTestTenantWithAdmin({ pool });
      const resourceId = `${tenant_id}:${admin_user_id}`;
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      await seedThread(storage, { id: 'staffing-1', resourceId, title: 'Staffing' });
      await seedThread(storage, {
        id: 'pmo-1',
        resourceId,
        title: 'PMO',
        metadata: { chatAgent: 'pmo' },
      });

      const app = makeApp({ tenant_id, user_id: admin_user_id, mastra, pool });
      const pmoRes = await app.request('/api/agent/v1/threads?agent=pmo');
      expect(pmoRes.status).toBe(200);
      const pmoBody = (await pmoRes.json()) as { threads: Array<{ id: string }> };
      expect(pmoBody.threads.map((t) => t.id)).toEqual(['pmo-1']);

      const staffingRes = await app.request('/api/agent/v1/threads?agent=staffing');
      expect(staffingRes.status).toBe(200);
      const staffingBody = (await staffingRes.json()) as { threads: Array<{ id: string }> };
      expect(staffingBody.threads.map((t) => t.id)).toEqual(['staffing-1']);

      const wrongAgentThread = await app.request('/api/agent/v1/threads/staffing-1?agent=pmo');
      expect(wrongAgentThread.status).toBe(404);

      const matchingAgentThread = await app.request('/api/agent/v1/threads/pmo-1?agent=pmo');
      expect(matchingAgentThread.status).toBe(200);
    });
  });

  it('GET /threads/:id returns 404 for a foreign thread', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const { admin_user_id, tenant_id } = await createTestTenantWithAdmin({ pool });
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      await seedThread(storage, { id: 'foreign-1', resourceId: 'someone-else', title: 'foreign' });

      const app = makeApp({ tenant_id, user_id: admin_user_id, mastra, pool });
      const res = await app.request('/api/agent/v1/threads/foreign-1');
      expect(res.status).toBe(404);
    });
  });

  it('PATCH /threads/:id returns 404 for a foreign thread (not 403)', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const { admin_user_id, tenant_id } = await createTestTenantWithAdmin({ pool });
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      await seedThread(storage, { id: 'foreign-2', resourceId: 'someone-else', title: 'foreign' });

      const app = makeApp({ tenant_id, user_id: admin_user_id, mastra, pool });
      const res = await app.request('/api/agent/v1/threads/foreign-2', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'renamed' }),
      });
      expect(res.status).toBe(404);
    });
  });

  it('GET /threads returns 401 when session missing', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      const app = new Hono<{ Variables: { session: TestSession } }>();
      registerAgentRoutes(app, {
        chatOrchestration: () => stubOrchestration(),
        mastra: mastra as never,
        pool,
      });
      const res = await app.request('/api/agent/v1/threads');
      expect(res.status).toBe(401);
    });
  });

  it('GET /threads returns 403 when permission missing', async () => {
    await withAgentTestDb(async ({ pool, databaseUrl }) => {
      const { admin_user_id, tenant_id } = await createTestTenantWithAdmin({ pool });
      const mastra = buildMastra({ pool, databaseUrl });
      const storage = mastra.getStorage();
      await (storage as { init: () => Promise<void> }).init();

      const app = makeApp({
        tenant_id,
        user_id: admin_user_id,
        permissions: ['agent.chat.use'],
        mastra,
        pool,
      });
      const res = await app.request('/api/agent/v1/threads');
      expect(res.status).toBe(403);
    });
  });
});
