import { Send } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/cn';
import { KbdHint } from './kbd-hint';

export interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  pending?: boolean;
  disabled?: boolean;
  agentSelector?: React.ReactNode;
  permissionHint?: string;
  className?: string;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  pending,
  disabled,
  agentSelector,
  permissionHint,
  className,
}: ChatComposerProps) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !pending && value.trim()) onSubmit();
    }
  };
  return (
    <div className={cn('border-t border-hairline bg-canvas px-6 py-5', className)}>
      <div className="mx-auto max-w-[720px]">
        <div className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
          <textarea
            className="block w-full resize-none bg-transparent text-body-sm placeholder:text-ink-subtle focus:outline-none"
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Ask Supervisor anything…'}
            disabled={disabled || pending}
          />
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-caption text-ink-subtle">
              {agentSelector}
              {permissionHint && <span>{permissionHint}</span>}
            </div>
            <div className="flex items-center gap-2 text-caption text-ink-subtle">
              <KbdHint keys={['⏎']} /> <span>send</span>
              <KbdHint keys={['⇧⏎']} /> <span>new line</span>
              <button
                type="button"
                onClick={() => !disabled && !pending && value.trim() && onSubmit()}
                disabled={disabled || pending || !value.trim()}
                aria-label="Send"
                className="ml-1 inline-flex size-7 items-center justify-center rounded-md bg-primary text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
