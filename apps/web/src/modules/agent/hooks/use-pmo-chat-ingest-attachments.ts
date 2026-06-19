import type { ComposerAttachment } from '@seta/shared-ui';
import { useCallback, useState } from 'react';
import { pmoApi } from '@/modules/pmo/api/client';

interface Item {
  localId: string;
  ingestionSessionId: string | null;
  filename: string;
  status: ComposerAttachment['status'];
  progress: number;
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

/** PMO Agent chat uploads: durable ingestion sessions via /api/pmo/v1/upload. */
export function usePmoChatIngestAttachments(chatThreadId: string | null) {
  const [items, setItems] = useState<Item[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

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
          } catch (e) {
            patch(localId, { status: 'failed' });
            setWarning(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
          }
        })();
      }
    },
    [patch, chatThreadId],
  );

  const remove = useCallback((localId: string) => {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setWarning(null);
  }, []);

  const pendingIngestSessionId =
    items.find((it) => it.status === 'uploaded' && it.ingestionSessionId)?.ingestionSessionId ??
    null;

  const attachments: ComposerAttachment[] = items.map((it) => ({
    id: it.localId,
    filename: it.filename,
    status: it.status,
    progress: it.progress,
  }));

  return { attachments, attach, remove, reset, warning, pendingIngestSessionId };
}
