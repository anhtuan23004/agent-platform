import type { PmoPlanActionId } from '../../planning/step-metadata.ts';
import type { PmoDynamicStepHandler } from './types.ts';

export class PmoDynamicStepRegistry {
  private readonly handlers = new Map<PmoPlanActionId, PmoDynamicStepHandler>();

  constructor(handlers: PmoDynamicStepHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.actionId, handler);
    }
  }

  resolve(actionId: PmoPlanActionId): PmoDynamicStepHandler | null {
    return this.handlers.get(actionId) ?? null;
  }

  list(): PmoPlanActionId[] {
    return [...this.handlers.keys()];
  }
}

export function buildPmoDynamicStepRegistry(
  handlers: PmoDynamicStepHandler[],
): PmoDynamicStepRegistry {
  return new PmoDynamicStepRegistry(handlers);
}
