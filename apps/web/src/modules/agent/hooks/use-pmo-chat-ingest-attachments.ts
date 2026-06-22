import type { ComposerAttachment } from '@seta/shared-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { type PmoPlanningSession, pmoApi } from '@/modules/pmo/api/client';

interface Item {
  localId: string;
  ingestionSessionId: string | null;
  filename: string;
  status: ComposerAttachment['status'];
  progress: number;
}

export interface PmoChatUploadSource {
  ingestionSessionId: string;
  label: string;
  isPublished: boolean;
  uploadedAt: string | null;
  /** True when this session was uploaded in the current chat thread. */
  fromCurrentThread: boolean;
}

function isWorkbook(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
    return true;
  }
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel'
  );
}

function sessionLabel(name: string | null, id: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${id.slice(0, 8)}…`;
}

/** PMO Agent chat uploads: durable ingestion sessions via /api/pmo/v1/upload. */
export function usePmoChatIngestAttachments(chatThreadId: string | null) {
  const [items, setItems] = useState<Item[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [explicitSelectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const threadSessions = useQuery({
    queryKey: ['pmo', 'chat-upload-sources', chatThreadId],
    enabled: Boolean(chatThreadId),
    queryFn: () => pmoApi.listPlanningSessions({ chatThreadId: chatThreadId ?? undefined }),
  });

  const allSessions = useQuery({
    queryKey: ['pmo', 'all-upload-sources'],
    enabled: Boolean(chatThreadId),
    queryFn: () => pmoApi.listPlanningSessions(),
  });

  const patch = useCallback((localId: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...next } : it)));
  }, []);

  const attach = useCallback(
    (files: File[]) => {
      for (const file of files) {
        if (!isWorkbook(file)) {
          setWarning(
            `${file.name}: only Excel workbooks (.xlsx, .xls) are supported for PMO ingest.`,
          );
          continue;
        }
        const localId = crypto.randomUUID();
        setItems((prev) => [
          ...prev,
          {
            localId,
            ingestionSessionId: null,
            filename: file.name,
            status: 'uploading',
            progress: 0,
          },
        ]);
        void (async () => {
          try {
            if (!chatThreadId) {
              throw new Error('Open or create a chat thread before uploading a workbook.');
            }
            patch(localId, { progress: 0.1 });
            const uploaded = await pmoApi.uploadWorkbook(file, {
              chatThreadId,
              onProgress: (p) => patch(localId, { progress: 0.1 + p * 0.9 }),
            });
            patch(localId, {
              ingestionSessionId: uploaded.ingestion_session_id,
              status: 'uploaded',
              progress: 1,
            });
            setSelectedSessionId(uploaded.ingestion_session_id);
            await queryClient.invalidateQueries({
              queryKey: ['pmo', 'chat-upload-sources', chatThreadId],
            });
            await queryClient.invalidateQueries({ queryKey: ['pmo', 'all-upload-sources'] });
          } catch (e) {
            patch(localId, { status: 'failed' });
            setWarning(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
          }
        })();
      }
    },
    [patch, chatThreadId, queryClient],
  );

  const remove = useCallback((localId: string) => {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  }, []);

  const resetAttachments = useCallback(() => {
    setItems([]);
    setWarning(null);
  }, []);

  const uploadSources = useMemo((): PmoChatUploadSource[] => {
    const byId = new Map<string, PmoChatUploadSource>();
    const threadSessionIds = new Set(
      (threadSessions.data?.items ?? []).map((session) => session.ingestion_session_id),
    );

    const addSession = (session: PmoPlanningSession, fromCurrentThread: boolean) => {
      if (byId.has(session.ingestion_session_id)) return;
      if (!session.is_published) return;
      byId.set(session.ingestion_session_id, {
        ingestionSessionId: session.ingestion_session_id,
        label: sessionLabel(session.workbook_name, session.ingestion_session_id),
        isPublished: session.is_published,
        uploadedAt: session.uploaded_at,
        fromCurrentThread,
      });
    };

    for (const session of threadSessions.data?.items ?? []) {
      addSession(session, true);
    }

    for (const session of allSessions.data?.items ?? []) {
      const fromCurrentThread =
        threadSessionIds.has(session.ingestion_session_id) ||
        session.chat_thread_id === chatThreadId;
      addSession(session, fromCurrentThread);
    }

    return [...byId.values()].sort((left, right) => {
      if (left.fromCurrentThread !== right.fromCurrentThread) {
        return left.fromCurrentThread ? -1 : 1;
      }
      if (left.isPublished !== right.isPublished) return left.isPublished ? -1 : 1;
      const leftTime = left.uploadedAt ? Date.parse(left.uploadedAt) : 0;
      const rightTime = right.uploadedAt ? Date.parse(right.uploadedAt) : 0;
      return rightTime - leftTime;
    });
  }, [allSessions.data?.items, chatThreadId, threadSessions.data?.items]);

  const selectedUploadSource = useMemo(() => {
    const explicit =
      explicitSelectedSessionId === null
        ? null
        : uploadSources.find((source) => source.ingestionSessionId === explicitSelectedSessionId);
    return explicit ?? uploadSources[0] ?? null;
  }, [explicitSelectedSessionId, uploadSources]);
  const selectedSessionId = selectedUploadSource?.ingestionSessionId ?? null;

  const refreshUploadSources = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ['pmo', 'chat-upload-sources', chatThreadId],
    });
    await queryClient.invalidateQueries({ queryKey: ['pmo', 'all-upload-sources'] });
  }, [chatThreadId, queryClient]);

  const uploadSourcesLoading = threadSessions.isLoading || allSessions.isLoading;

  const attachments: ComposerAttachment[] = items.map((it) => ({
    id: it.localId,
    filename: it.filename,
    status: it.status,
    progress: it.progress,
  }));

  return {
    attachments,
    attach,
    remove,
    reset: resetAttachments,
    warning,
    uploadSources,
    uploadSourcesLoading,
    refreshUploadSources,
    selectedSessionId,
    setSelectedSessionId,
    selectedUploadSource,
    /** Published upload selected for scoped analytics in this chat turn. */
    scopedIngestSessionId:
      selectedUploadSource?.isPublished === true ? selectedUploadSource.ingestionSessionId : null,
  };
}
