import type { ApprovalCard } from '@seta/agent-sdk';
import type { ChatStreamRun } from '@seta/shared-orchestration';

export interface UiStreamWriter {
  write(chunk: unknown): void;
}

/** A persisted assistant-message part. The streamed `text` prose is the answer;
 *  `data-result` carries the structured payload for cards; `data-trust` carries
 *  confidence + citations. */
export type OrchestrationAssistantPart =
  | { type: 'text'; text: string }
  | { type: 'data-result'; id: 'result'; data: unknown }
  | { type: 'data-trust'; id: 'trust'; data: unknown };

/** The suspend signal as it survives `@mastra/ai-sdk` conversion: a data part
 *  carrying the run id, tool-call id, and the tool's suspend payload (our card). */
interface SuspendData {
  runId: string;
  toolCallId: string;
  suspendPayload: { card: ApprovalCard };
}

export interface ApprovalEvent {
  card: ApprovalCard;
  mastraRunId: string;
  toolCallId: string;
}

/**
 * Pump an AI SDK v6 UIMessage part stream into the writer, accumulating the
 * answer prose for persistence and detecting native HITL suspend.
 *
 * - Every part is written through (live streaming to the client).
 * - `text-delta` parts accumulate into the persisted answer text.
 * - A `data-tool-call-suspended` part means the run paused for approval: the
 *   `onApproval` hook fires (writes the read-model row) and `finalize` is NOT
 *   called (a suspended turn has no assembled result).
 * - On normal completion, `finalize()` produces the structured result + trust,
 *   written as reconciled `data-result` / `data-trust` cards.
 */
export async function pumpOrchestrationStream(
  writer: UiStreamWriter,
  parts: AsyncIterable<{ type: string; delta?: string; text?: string; data?: unknown }>,
  opts: {
    finalize: ChatStreamRun['finalize'];
    onApproval: (e: ApprovalEvent) => Promise<void>;
  },
): Promise<{ assistantParts: OrchestrationAssistantPart[] }> {
  const assistantParts: OrchestrationAssistantPart[] = [];
  let answer = '';
  let suspend: ApprovalEvent | undefined;
  let streamError: unknown;

  // The for-await MUST be wrapped in try/catch: if the ReadableStream errors
  // (e.g. the Mastra agent loop continues after a native-suspend tool returns
  // and a subsequent chunk causes a transform error), the loop throws. Without
  // the catch, `onApproval` is never called and the approval row is never
  // created — even though the `data-tool-call-suspended` chunk was already
  // captured into `suspend`. This was the root cause of missing PMO approval
  // rows: the card showed (emitted before the error) but the DB write was
  // skipped because control never reached the `if (suspend)` block.
  try {
    for await (const part of parts) {
      if (part.type === 'data-tool-call-suspended') {
        const d = part.data as SuspendData;
        suspend = { card: d.suspendPayload.card, mastraRunId: d.runId, toolCallId: d.toolCallId };
        continue;
      }
      writer.write(part);
      if (part.type === 'text-delta') answer += part.delta ?? part.text ?? '';
    }
  } catch (err) {
    streamError = err;
  }

  if (answer) assistantParts.push({ type: 'text', text: answer });

  if (suspend) {
    await opts.onApproval(suspend);
    return { assistantParts };
  }

  // If the stream errored and there was no suspend, re-throw so the caller
  // (createUIMessageStream execute callback) surfaces the error.
  if (streamError) throw streamError;

  const { result, trust } = await opts.finalize();
  writer.write({ type: 'data-result', id: 'result', data: result });
  writer.write({ type: 'data-trust', id: 'trust', data: trust });
  assistantParts.push({ type: 'data-result', id: 'result', data: result });
  assistantParts.push({ type: 'data-trust', id: 'trust', data: trust });
  return { assistantParts };
}
