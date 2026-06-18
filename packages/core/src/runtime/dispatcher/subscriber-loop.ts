import type { SubscriberDef } from '@seta/shared-types';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema/index.ts';
import { type BackoffOpts, type DrainLogger, type DrainMetrics, drainOne } from './drain.ts';

export interface SubscriberLoopHandle {
  /** Notify the loop that there may be new work (called from LISTEN). */
  notify(): void;
  /** Stop ticking; waits for any in-flight drain up to timeoutMs. */
  shutdown(timeoutMs?: number): Promise<void>;
}

export interface SubscriberDrainObserver {
  /** Called after each drain attempt (success or thrown). */
  onDrain(args: { subscription: string; processed: number; durationMs: number }): void;
  /** Called when drain itself throws — i.e., the loop dropped a tick. */
  onError(args: { subscription: string; err: unknown }): void;
}

export function startSubscriberLoop(opts: {
  db: NodePgDatabase<typeof schema>;
  sub: SubscriberDef;
  backoff: BackoffOpts;
  pollIntervalMs: number;
  log: DrainLogger;
  metrics: DrainMetrics;
  observer: SubscriberDrainObserver;
}): SubscriberLoopHandle {
  let shuttingDown = false;
  let inFlight: Promise<void> | null = null;

  function scheduleTick(): void {
    if (shuttingDown || inFlight) return;
    const drain = (async () => {
      const started = Date.now();
      let processed = 0;
      try {
        const result = await drainOne(opts.db, opts.sub, opts.backoff, opts.log, opts.metrics);
        processed = result.processed;
      } catch (err) {
        opts.observer.onError({ subscription: opts.sub.subscription, err });
      } finally {
        opts.observer.onDrain({
          subscription: opts.sub.subscription,
          processed,
          durationMs: Date.now() - started,
        });
      }
    })();
    inFlight = drain;
    void drain.finally(() => {
      if (inFlight === drain) inFlight = null;
    });
  }

  // Independent setInterval per subscriber — fast subscribers keep ticking even
  // while a slow peer is mid-handler.
  const interval = setInterval(scheduleTick, opts.pollIntervalMs);
  // Kick once immediately so a freshly-started dispatcher drains backlog.
  scheduleTick();

  return {
    notify() {
      scheduleTick();
    },
    async shutdown(timeoutMs = 15_000) {
      shuttingDown = true;
      clearInterval(interval);
      const deadline = Date.now() + timeoutMs;
      // Yield so a tick that passed the pre-shuttingDown guard can publish inFlight.
      while (!inFlight && Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, 10));
      }
      if (inFlight) {
        await Promise.race([
          inFlight,
          new Promise<void>((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
        ]);
      }
    },
  };
}
