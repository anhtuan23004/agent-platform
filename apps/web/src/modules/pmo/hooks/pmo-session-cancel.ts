import type { PmoPlanningSession } from '../api/client';

const TERMINAL_RUNTIME_STATUSES = new Set(['success', 'failed', 'tripwire', 'canceled']);
const TERMINAL_SESSION_STATUSES = new Set(['published', 'failed', 'rejected']);

export function isPmoSessionCancelable(
  session: PmoPlanningSession,
  runtimeStatus: string | null | undefined,
): boolean {
  if (
    session.workflow_step_status === 'completed' ||
    session.workflow_step_status === 'failed' ||
    session.workflow_step_status === 'cancelled'
  ) {
    return false;
  }
  if (TERMINAL_SESSION_STATUSES.has(session.status)) return false;
  if (runtimeStatus && TERMINAL_RUNTIME_STATUSES.has(runtimeStatus)) return false;
  return true;
}

export function isPmoSessionGeneratable(session: PmoPlanningSession): boolean {
  return (
    (session.planning_state === 'uploaded' ||
      session.planning_state === 'plan_generation_failed') &&
    session.workflow_step_status !== 'cancelled'
  );
}
