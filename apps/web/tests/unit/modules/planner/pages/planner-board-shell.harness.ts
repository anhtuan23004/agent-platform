import { screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

/** PlanBoardShell tests render without the planner route's EventSource wiring. */
export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;

  constructor(url: string, init?: EventSourceInit) {
    super();
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  close = vi.fn();
}

export function stubPlannerBoardEventSource(): void {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  FakeEventSource.instances = [];
}

export function unstubPlannerBoardEventSource(): void {
  vi.unstubAllGlobals();
}

export async function waitForPlannerShellReady(options?: {
  taskTitle?: string;
  timeout?: number;
}): Promise<void> {
  const timeout = options?.timeout ?? 10_000;
  const taskTitle = options?.taskTitle;

  await waitFor(
    () => {
      expect(screen.queryByTestId('grid-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByTestId('board-skeleton')).not.toBeInTheDocument();
      if (taskTitle) {
        expect(screen.getByText(taskTitle)).toBeInTheDocument();
      }
    },
    { timeout },
  );
}
