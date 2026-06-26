import { useAui, useAuiState } from '@assistant-ui/react';
import { attachmentsBlockSend, ChatComposer, Label } from '@seta/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ModelSelector } from '../components/model-selector';
import { useChatAttachments } from '../hooks/use-chat-attachments';
import { usePmoChatIngestAttachments } from '../hooks/use-pmo-chat-ingest-attachments';
import { CHAT_AGENT_COPY } from '../i18n';
import {
  useAgentRuntimeContext,
  useAgentSelection,
  useChatAgent,
  usePanelUI,
  usePmoIngestSendRef,
} from './agent-provider';

interface AgentComposerProps {
  compact?: boolean;
}

export function AgentComposer({ compact = false }: AgentComposerProps) {
  const [value, setValue] = useState('');
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { selection, actions } = useAgentSelection();
  const { chatAgent } = useChatAgent();
  const { pendingPrompt, setPendingPrompt } = usePanelUI();
  const { runError, clearRunError } = useAgentRuntimeContext();
  const pmoIngestSendRef = usePmoIngestSendRef();
  const staffingAttachments = useChatAttachments(selection.threadId);
  const pmoIngestAttachments = usePmoChatIngestAttachments(selection.threadId);
  const isPmo = chatAgent === 'pmo';
  const attachments = isPmo ? pmoIngestAttachments.attachments : staffingAttachments.attachments;
  const attach = isPmo ? pmoIngestAttachments.attach : staffingAttachments.attach;
  const remove = isPmo ? pmoIngestAttachments.remove : staffingAttachments.remove;
  const reset = isPmo ? pmoIngestAttachments.reset : staffingAttachments.reset;
  const warning = isPmo ? pmoIngestAttachments.warning : staffingAttachments.warning;
  const uploadSources = isPmo ? pmoIngestAttachments.uploadSources : [];
  const uploadSourcesLoading = isPmo ? pmoIngestAttachments.uploadSourcesLoading : false;
  const refreshUploadSources = isPmo ? pmoIngestAttachments.refreshUploadSources : async () => {};
  const selectedSessionId = isPmo ? pmoIngestAttachments.selectedSessionId : null;
  const setSelectedSessionId = isPmo ? pmoIngestAttachments.setSelectedSessionId : () => {};
  const selectedUploadSource = isPmo ? pmoIngestAttachments.selectedUploadSource : null;
  const scopedIngestSessionId = isPmo ? pmoIngestAttachments.scopedIngestSessionId : null;
  const publishedUploadSources = isPmo
    ? uploadSources.filter((source) => source.group === 'published')
    : [];
  const myUploadSources = isPmo ? uploadSources.filter((source) => source.group === 'mine') : [];

  const submit = () => {
    if (!value.trim() || isRunning) return;
    if (attachmentsBlockSend(attachments)) return;
    clearRunError();
    if (isPmo && scopedIngestSessionId) {
      const from = selectedUploadSource?.reportingPeriodStart?.slice(0, 10);
      const to = selectedUploadSource?.reportingPeriodEnd?.slice(0, 10);
      pmoIngestSendRef.current = {
        ingestionSessionId: scopedIngestSessionId,
        ...(from && to ? { reportingDateFrom: from, reportingDateTo: to } : {}),
      };
    } else if (isPmo) {
      pmoIngestSendRef.current = {};
    } else {
      pmoIngestSendRef.current = {};
    }
    aui.composer().setText(value);
    aui.composer().send();
    setValue('');
    if (isPmo) {
      void refreshUploadSources();
    }
    reset();
  };

  // Guard against double-fire when `aui` reference changes before
  // the `setPendingPrompt(null)` state update propagates.
  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (pendingPrompt) pendingConsumedRef.current = false;
  }, [pendingPrompt]);
  useEffect(() => {
    if (!pendingPrompt || isRunning || pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;
    const { text, autoSend } = pendingPrompt;
    setPendingPrompt(null);
    if (autoSend) {
      aui.composer().setText(text);
      aui.composer().send();
      return;
    }
    aui.composer().setText(text);
  }, [pendingPrompt, isRunning, aui, setPendingPrompt]);

  return (
    <>
      {runError && (
        <div className="border-t border-hairline bg-canvas px-3 pt-3 md:px-4">
          <div className="mx-auto flex max-w-conversation items-start gap-2 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2 text-caption text-[var(--color-danger)]">
            <span role="alert" className="min-w-0 flex-1 break-words">
              {runError}
            </span>
            <button
              type="button"
              onClick={clearRunError}
              aria-label="Dismiss error"
              className="flex-none opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}
      <ChatComposer
        value={value}
        onChange={setValue}
        onSubmit={submit}
        pending={isRunning}
        placeholder={
          isPmo
            ? 'Ask about published PMO utilization data…'
            : CHAT_AGENT_COPY[chatAgent].placeholder
        }
        permissionHint={
          isPmo ? (
            <div className="flex w-full min-w-0 flex-col gap-1.5">
              <span className={warning ? 'text-warning-ink' : undefined}>
                {warning ?? 'Published PMO data only.'}
              </span>
              {uploadSourcesLoading ? (
                <span>Loading uploads…</span>
              ) : uploadSources.length > 0 ? (
                <>
                  <Label htmlFor="pmo-chat-upload-source" className="text-caption font-medium">
                    Upload source
                  </Label>
                  <select
                    id="pmo-chat-upload-source"
                    className="w-full rounded-md border border-hairline bg-surface-1 px-2 py-1.5 text-body-sm text-ink"
                    value={selectedSessionId ?? ''}
                    onChange={(event) => setSelectedSessionId(event.target.value || null)}
                  >
                    {publishedUploadSources.length > 0 ? (
                      <optgroup label="Published data">
                        {publishedUploadSources.map((source) => (
                          <option
                            key={source.ingestionSessionId}
                            value={source.ingestionSessionId}
                            disabled={source.disabled}
                          >
                            {source.label}
                            {source.fromCurrentThread ? '' : ' · other thread'}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {myUploadSources.length > 0 ? (
                      <optgroup label="Your uploads">
                        {myUploadSources.map((source) => (
                          <option
                            key={source.ingestionSessionId}
                            value={source.ingestionSessionId}
                            disabled={source.disabled}
                          >
                            {source.label}
                            {source.isPublished ? ' · published' : ' · not published yet'}
                            {source.fromCurrentThread ? ' · this thread' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </>
              ) : null}
              {selectedUploadSource?.isPublished ? (
                <span>Analytics tools will use this published batch only.</span>
              ) : null}
            </div>
          ) : (
            warning
          )
        }
        attachments={attachments}
        onAttachFiles={attach}
        onRemoveAttachment={remove}
        toolbar={
          <ModelSelector
            value={selection.modelKey}
            onChange={actions.setModelKey}
            variant="ghost"
            compact={compact}
          />
        }
      />
    </>
  );
}
