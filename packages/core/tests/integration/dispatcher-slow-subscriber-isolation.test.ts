import { describe, expect, it } from 'vitest';
import { resetCoreDb } from '../../src/db/client.ts';
import { emit, withEmit } from '../../src/events/index.ts';
import { startDispatcher } from '../../src/runtime/dispatcher/index.ts';
import { waitFor, withCoreTestDb } from '../helpers.ts';

describe('dispatcher per-subscriber isolation', () => {
  it('slow subscriber does not block fast one within one wall-clock window', async () => {
    await withCoreTestDb(async ({ pool }) => {
      resetCoreDb();

      let slowSeen = 0;
      let fastSeen = 0;

      const slowSub = {
        subscription: 'test.iso.slow',
        event: 'test.iso.entity.created',
        eventVersion: 1,
        handler: async () => {
          slowSeen += 1;
          await new Promise((r) => setTimeout(r, 300));
        },
      };
      const fastSub = {
        subscription: 'test.iso.fast',
        event: 'test.iso.entity.created',
        eventVersion: 1,
        handler: async () => {
          fastSeen += 1;
        },
      };

      const EVENTS = 10;
      const d = await startDispatcher({
        pool,
        subscribers: [slowSub, fastSub],
        pollIntervalMs: 25,
      });
      try {
        await withEmit(undefined, async () => {
          for (let i = 0; i < EVENTS; i++) {
            await emit({
              tenantId: '00000000-0000-0000-0000-000000000001',
              aggregateType: 'test.iso',
              aggregateId: '00000000-0000-0000-0000-000000000001',
              eventType: 'test.iso.entity.created',
              eventVersion: 1,
              payload: { i },
            });
          }
        });

        // Fast must finish all EVENTS while slow is still catching up. If subscribers were
        // serialized, slow's 300ms handler would gate fast and both counts would stay aligned.
        await waitFor(() => fastSeen === EVENTS, 3_000);
        expect(fastSeen).toBe(EVENTS);
        expect(slowSeen).toBeLessThan(EVENTS);
        expect(slowSeen).toBeLessThan(fastSeen);
      } finally {
        await d.shutdown(10_000);
      }
    });
  });
});
