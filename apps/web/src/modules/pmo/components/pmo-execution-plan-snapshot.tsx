import type { PmoPlan, PmoPlanningSession } from '../api/client';
import { formatLocalDate } from '../pages/pmo-page.logic';

interface PmoExecutionPlanSnapshotProps {
  selectedSession: PmoPlanningSession;
  plan: PmoPlan | null;
  goalDraft: string;
}

export function PmoExecutionPlanSnapshot(props: PmoExecutionPlanSnapshotProps) {
  const { selectedSession, plan, goalDraft } = props;

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-hairline bg-canvas p-2.5">
      <p className="font-medium text-ink">Final plan snapshot</p>
      <p>
        <span className="font-medium text-ink">Plan title:</span>{' '}
        {plan?.title ?? 'No generated plan title.'}
      </p>
      <p>
        <span className="font-medium text-ink">Interpreted goal:</span>{' '}
        {(plan?.goal_summary ?? selectedSession.goal) || goalDraft}
      </p>
      <p>
        <span className="font-medium text-ink">Approved at:</span>{' '}
        {formatLocalDate(selectedSession.plan_approved_at)}
      </p>
    </div>
  );
}
