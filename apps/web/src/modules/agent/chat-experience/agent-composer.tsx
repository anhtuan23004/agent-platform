import { useAui, useAuiState } from '@assistant-ui/react';
import { attachmentsBlockSend, ChatComposer } from '@seta/shared-ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const pendingIngestSessionId = isPmo ? pmoIngestAttachments.pendingIngestSessionId : null;

  const submit = () => {
    if (!value.trim() || isRunning) return;
    if (attachmentsBlockSend(attachments)) return;
    clearRunError();
    if (isPmo && pendingIngestSessionId) {
      pmoIngestSendRef.current = { ingestionSessionId: pendingIngestSessionId };
    } else if (!isPmo) {
      pmoIngestSendRef.current = {};
    }
    aui.composer().setText(value);
    aui.composer().send();
    setValue('');
    reset();
  };

  useEffect(() => {
    if (!pendingPrompt || isRunning) return;
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
            ? 'Upload a workbook to ingest, or ask about utilization…'
            : CHAT_AGENT_COPY[chatAgent].placeholder
        }
        permissionHint={
          warning ??
          (isPmo
            ? 'Excel workbooks upload as PMO ingestion sessions for ingest workflow.'
            : undefined)
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
