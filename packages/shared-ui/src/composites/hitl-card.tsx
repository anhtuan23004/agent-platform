import { Check, Clock, Sparkles } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { useHitlDecision } from '../hooks/use-hitl-decision';
import { type BlockProps, blockRenderers, type EntityRef } from './hitl-blocks';

interface CardShape {
  intent?: string;
  riskBadge?: 'write' | 'destructive' | 'external';
  summary?: string;
  agentNote?: string;
  clarifications?: Array<{ role: string; message: string; ts: string }>;
  details: Array<{ kind: string } & Record<string, unknown>>;
  primary: { label: string };
  alternates?: Array<{ label: string }>;
  decline: { label: string };
}

export interface HitlCardProps {
  card: CardShape;
  canAct: boolean;
  pending?: boolean;
  expiresAt?: string;
  onDecide: (decision: {
    decision: 'approve' | 'reject' | 'modify';
    overrideUserIds?: string[];
    note?: string;
  }) => void;
  onClarify?: (message: string) => void;
  renderEntity: (entity: EntityRef) => ReactNode;
  cardRenderers?: Record<string, ComponentType<BlockProps>>;
}

type RiskBadge = 'write' | 'destructive' | 'external';
const RISK_LABEL: Record<RiskBadge, string> = {
  write: 'Write',
  destructive: 'Destructive',
  external: 'External',
};
const RISK_CLASS: Record<RiskBadge, string> = {
  write: 'bg-primary/12 text-primary-ink',
  destructive: 'bg-danger-tint text-danger-ink',
  external: 'bg-warning-tint text-warning-ink',
};

function formatRemaining(ms: number): { label: string; tier: 'ok' | 'soon' | 'urgent' } {
  if (ms <= 0) return { label: 'expired', tier: 'urgent' };
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  let label: string;
  if (d > 0) label = h > 0 ? `${d}d ${h}h left` : `${d}d left`;
  else if (h > 0) label = m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  else if (m > 0) label = `${m}m ${s.toString().padStart(2, '0')}s left`;
  else label = `${s}s left`;
  const tier: 'ok' | 'soon' | 'urgent' = ms < 30_000 ? 'urgent' : ms < 120_000 ? 'soon' : 'ok';
  return { label, tier };
}

// Blocks carry no stable id; derive a key from kind + content so React reconciles
// distinct blocks of the same kind without falling back to array index.
function blockKey(block: { kind: string }): string {
  try {
    return `${block.kind}:${JSON.stringify(block)}`;
  } catch {
    return block.kind;
  }
}

const countdownToneClass: Record<'ok' | 'soon' | 'urgent', string> = {
  ok: 'text-primary-ink/80',
  soon: 'text-warning-ink',
  urgent: 'text-danger-ink',
};

function ClarificationSection({
  agentNote,
  clarifications,
  onSend,
}: {
  agentNote?: string;
  clarifications: Array<{ role: string; message: string; ts: string }>;
  onSend?: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const hasMessages = Boolean(agentNote) || clarifications.length > 0;
  if (!hasMessages && !onSend) return null;

  return (
    <div className="mx-3.5 mt-3 rounded-lg border border-hairline bg-surface-1">
      {/* Message history */}
      <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2">
        {agentNote ? (
          <div className="flex gap-2">
            <span className="shrink-0 text-caption font-semibold text-primary-ink">Agent:</span>
            <p className="text-caption text-ink">{agentNote}</p>
          </div>
        ) : null}
        {clarifications.map((msg) => (
          <div key={msg.ts} className="flex gap-2">
            <span
              className={`shrink-0 text-caption font-semibold ${msg.role === 'agent' ? 'text-primary-ink' : 'text-ink'}`}
            >
              {msg.role === 'agent' ? 'Agent:' : 'You:'}
            </span>
            <p className="text-caption text-ink">{msg.message}</p>
          </div>
        ))}
      </div>
      {/* Input */}
      {onSend ? (
        <div className="flex items-center gap-1.5 border-t border-hairline px-3 py-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                onSend(text.trim());
                setText('');
              }
            }}
            placeholder="Type your message..."
            className="flex-1 rounded-md border border-hairline-strong bg-canvas px-2.5 py-1.5 text-body-sm text-ink placeholder:text-ink-tertiary focus:border-primary-border focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (text.trim()) {
                onSend(text.trim());
                setText('');
              }
            }}
            disabled={!text.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-body-sm font-semibold text-on-primary disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function HitlCard({
  card,
  canAct,
  pending,
  expiresAt,
  onDecide,
  onClarify,
  renderEntity,
  cardRenderers,
}: HitlCardProps) {
  const { selectedIds, toggle, toDecision } = useHitlDecision(card);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');

  // Drive the countdown + expired flag with a 1s tick, but only when an
  // expiry is supplied — no timer (and never expired) when expiresAt is absent.
  const deadlineMs = expiresAt ? new Date(expiresAt).getTime() : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadlineMs === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineMs]);

  const remaining = deadlineMs !== undefined ? formatRemaining(deadlineMs - now) : undefined;
  const expired = deadlineMs !== undefined && deadlineMs - now <= 0;
  const disabled = !canAct || Boolean(pending) || expired;

  const intent = card.intent ?? 'Your input needed';

  return (
    <section
      aria-label={intent}
      className="overflow-hidden rounded-xl border-[1.5px] border-primary-border bg-canvas shadow-[0_0_0_4px_var(--color-primary-tint),0_10px_24px_-14px_rgb(0_0_0/0.25)]"
    >
      <header className="flex items-start gap-2.5 border-b border-primary-border bg-primary-tint px-3.5 py-2">
        <Sparkles className="mt-[3px] size-3.5 shrink-0 text-primary" aria-hidden />
        <h3 className="line-clamp-2 flex-1 text-body-sm font-semibold text-primary-ink">
          {intent}
        </h3>
        {card.riskBadge ? (
          <span
            className={`shrink-0 rounded-sm px-1 text-[10px] font-medium uppercase tracking-wide ${RISK_CLASS[card.riskBadge] ?? ''}`}
          >
            {RISK_LABEL[card.riskBadge] ?? card.riskBadge}
          </span>
        ) : null}
        {remaining ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 font-mono text-caption tabular-nums ${countdownToneClass[remaining.tier]}`}
            aria-live={remaining.tier === 'urgent' ? 'polite' : 'off'}
          >
            <Clock className="size-3" aria-hidden />
            {remaining.label}
          </span>
        ) : null}
      </header>

      {card.clarifications?.length || card.agentNote ? (
        <ClarificationSection
          agentNote={card.agentNote}
          clarifications={card.clarifications ?? []}
          onSend={canAct && !disabled ? (msg) => onClarify?.(msg) : undefined}
        />
      ) : null}

      <div className="px-3.5 py-3">
        {card.summary ? (
          <p className="mb-2.5 text-caption text-ink-subtle">{card.summary}</p>
        ) : null}

        <fieldset disabled={disabled} className="space-y-2.5">
          {card.details.map((block) => {
            // Built-in renderers win; cardRenderers is an escape hatch for unknown kinds.
            const Renderer = blockRenderers[block.kind] ?? cardRenderers?.[block.kind];
            if (!Renderer) return null;
            return (
              <Renderer
                key={blockKey(block)}
                block={block}
                selectedIds={selectedIds}
                onToggle={toggle}
                renderEntity={renderEntity}
              />
            );
          })}
        </fieldset>

        {!rejectOpen ? (
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDecide(toDecision('approve'))}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-body-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden />
              {pending ? 'Working…' : card.primary.label}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRejectOpen(true)}
              className="ml-auto rounded-md px-3 py-1.5 text-body-sm text-danger-ink hover:bg-danger-tint disabled:cursor-not-allowed disabled:opacity-50"
            >
              {card.decline.label}
            </button>
          </div>
        ) : (
          <div className="mt-3.5 rounded-lg border border-hairline-strong bg-surface-1 p-2.5">
            <label className="block text-caption text-ink-subtle">
              Reason (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full resize-none rounded-md border border-hairline-strong bg-canvas px-2.5 py-1.5 text-body-sm text-ink placeholder:text-ink-tertiary focus:border-primary-border focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setRejectOpen(false);
                  setNote('');
                }}
                className="rounded-md px-2.5 py-1.5 text-body-sm text-ink-subtle hover:bg-surface-2 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDecide(toDecision('reject', note.trim() || undefined))}
                className="rounded-md bg-danger px-3 py-1.5 text-body-sm font-semibold text-on-destructive shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirm decline
              </button>
            </div>
          </div>
        )}

        {!canAct ? (
          <p className="mt-3 rounded-md bg-surface-2 px-2.5 py-1.5 text-caption text-ink-subtle">
            You don&apos;t have permission to decide this one.
          </p>
        ) : expired ? (
          <p className="mt-3 rounded-md bg-danger-tint px-2.5 py-1.5 text-caption text-danger-ink">
            This approval has expired.
          </p>
        ) : null}
      </div>
    </section>
  );
}
