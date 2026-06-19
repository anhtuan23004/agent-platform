import { Button } from '@seta/shared-ui';
import { Loader2 } from 'lucide-react';
import type { PmoPlanningSession } from '../api/client';
import { formatLocalDate, statusTone } from '../pages/pmo-page.logic';

interface PmoSessionHistoryPanelProps {
  sessions: PmoPlanningSession[];
  selectedSessionId: string | null;
  isLoadingSessions: boolean;
  isCancellingWorkflowBySessionId: Record<string, boolean>;
  isGenerating: boolean;
  isWorkflowCancelable: (session: PmoPlanningSession) => boolean;
  isSessionGeneratable: (session: PmoPlanningSession) => boolean;
  onSelectSession: (sessionId: string) => void;
  onViewSession: (sessionId: string) => void;
  onGeneratePlan: (session: PmoPlanningSession) => void | Promise<void>;
  onCancelWorkflow: (session: PmoPlanningSession) => void | Promise<void>;
}

export function PmoSessionHistoryPanel(props: PmoSessionHistoryPanelProps) {
  const {
    sessions,
    selectedSessionId,
    isLoadingSessions,
    isCancellingWorkflowBySessionId,
    isGenerating,
    isWorkflowCancelable,
    isSessionGeneratable,
    onSelectSession,
    onViewSession,
    onGeneratePlan,
    onCancelWorkflow,
  } = props;

  return (
    <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-body-sm font-semibold text-ink">Upload history</h3>
          <p className="text-caption text-ink-subtle">
            Persisted sessions. View opens Plan tab first.
          </p>
        </div>
        {isLoadingSessions ? (
          <span className="inline-flex items-center gap-1 text-caption text-ink-subtle">
            <Loader2 className="size-3.5 animate-spin" />
            Loading...
          </span>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <section className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
          No runs yet. Upload a workbook and click Analyze &amp; Generate Plan.
        </section>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-body-sm">
            <thead className="border-b border-hairline text-caption uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Workbook</th>
                <th className="px-2 py-2">Uploaded at</th>
                <th className="px-2 py-2">Operator</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Active gate</th>
                <th className="px-2 py-2">Progress</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((run, index) => {
                const selected = run.ingestion_session_id === selectedSessionId;
                const canCancel = isWorkflowCancelable(run);
                const canGenerate = isSessionGeneratable(run);
                const isCancelling =
                  isCancellingWorkflowBySessionId[run.ingestion_session_id] ?? false;

                return (
                  <tr
                    key={run.ingestion_session_id}
                    className={`cursor-pointer border-b border-hairline ${
                      selected ? 'bg-primary-tint/30' : ''
                    }`}
                    onClick={() => onSelectSession(run.ingestion_session_id)}
                  >
                    <td className="px-2 py-2 text-ink-subtle">{index + 1}</td>
                    <td className="px-2 py-2 font-medium text-ink">{run.workbook_name}</td>
                    <td className="px-2 py-2 text-ink-subtle">
                      {formatLocalDate(run.uploaded_at)}
                    </td>
                    <td className="px-2 py-2 text-ink-subtle">{run.operator}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-caption font-medium ${statusTone(run.status_label)}`}
                      >
                        {run.status_label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-ink-subtle">{run.active_gate}</td>
                    <td className="px-2 py-2">
                      <div className="w-[170px]">
                        <p className="text-caption text-ink-subtle">{run.progress_text}</p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-success"
                            style={{ width: `${run.progress_pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewSession(run.ingestion_session_id);
                          }}
                        >
                          View
                        </Button>
                        {canGenerate ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="primary"
                            disabled={isGenerating}
                            onClick={(event) => {
                              event.stopPropagation();
                              void onGeneratePlan(run);
                            }}
                          >
                            {isGenerating ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              'Generate'
                            )}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canCancel || isCancelling}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onCancelWorkflow(run);
                          }}
                        >
                          {isCancelling ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Cancelling...
                            </>
                          ) : (
                            'Cancel'
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
