export type ApprovalsPollItem = {
  status: string;
  decidedAt?: string | null;
  createdAt: string;
};

const THREAD_APPROVALS_POLL_MS = 4_000;
const PENDING_APPROVALS_POLL_MS = 5_000;
const RECENT_APPROVAL_ACTIVITY_MS = 30_000;

/** Poll thread approvals while pending or briefly after recent HITL activity. */
export function threadApprovalsRefetchInterval(
  items: readonly ApprovalsPollItem[] | undefined,
): number | false {
  if (!items?.length) {
    return false;
  }

  if (items.some((approval) => approval.status === 'pending')) {
    return THREAD_APPROVALS_POLL_MS;
  }

  const now = Date.now();
  const lastActivity = Math.max(
    ...items.map((approval) => {
      const decided = approval.decidedAt ? new Date(approval.decidedAt).getTime() : 0;
      const created = new Date(approval.createdAt).getTime();
      return Math.max(decided, created);
    }),
  );

  if (now - lastActivity < RECENT_APPROVAL_ACTIVITY_MS) {
    return THREAD_APPROVALS_POLL_MS;
  }

  return false;
}

/** Poll the cross-thread pending inbox only while there are open approvals. */
export function pendingApprovalsRefetchInterval(
  items: readonly ApprovalsPollItem[] | undefined,
): number | false {
  if (!items?.length) {
    return false;
  }

  if (items.some((approval) => approval.status === 'pending')) {
    return PENDING_APPROVALS_POLL_MS;
  }

  return false;
}
