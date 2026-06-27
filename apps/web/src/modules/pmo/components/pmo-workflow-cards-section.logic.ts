import type { ExecutionCard } from '../pages/pmo-page.logic';
import { workflowStepTone } from '../pages/pmo-page.logic';
import type { PmoExecutionStepRuntimeProps } from './pmo-execution-step-card';

type WorkflowCardKind = 'execution';
export type WorkflowCardAccess = 'history_view_only' | 'current_actionable' | 'future_locked';

export interface WorkflowCardModel {
  id: string;
  ordinal: number;
  kind: WorkflowCardKind;
  label: string;
  statusLabel: string;
  access: WorkflowCardAccess;
  step?: ExecutionCard;
}

function findCurrentExecutionIndex(cards: ExecutionCard[], runtime: PmoExecutionStepRuntimeProps) {
  if (cards.length === 0) return -1;

  const currentByNo =
    typeof runtime.executionCurrentStepNo === 'number'
      ? cards.findIndex((step) => step.step_no === runtime.executionCurrentStepNo)
      : -1;
  if (currentByNo >= 0) return currentByNo;

  const statusIndex = cards.findIndex(
    (step) =>
      step.status === 'in_progress' || step.status === 'needs_review' || step.status === 'failed',
  );
  if (statusIndex >= 0) return statusIndex;

  return cards.findIndex((step) => step.status === 'pending');
}

export function buildWorkflowCards(params: {
  executionCards: ExecutionCard[];
  runtime: PmoExecutionStepRuntimeProps;
  readOnly?: boolean;
}): WorkflowCardModel[] {
  const { executionCards, runtime, readOnly } = params;

  if (readOnly) {
    return executionCards.map((step, index) => ({
      id: `execution-${step.step_no}`,
      ordinal: index + 1,
      kind: 'execution',
      label: step.step_name,
      statusLabel: workflowStepTone(step.status).label,
      access: 'history_view_only',
      step,
    }));
  }

  const cards: WorkflowCardModel[] = [];
  const currentIndex = findCurrentExecutionIndex(executionCards, runtime);

  for (const [index, step] of executionCards.entries()) {
    const access: WorkflowCardAccess =
      currentIndex >= 0
        ? index < currentIndex
          ? 'history_view_only'
          : index === currentIndex
            ? 'current_actionable'
            : 'future_locked'
        : step.status === 'completed'
          ? 'history_view_only'
          : 'future_locked';

    cards.push({
      id: `execution-${step.step_no}`,
      ordinal: index + 1,
      kind: 'execution',
      label: step.step_name,
      statusLabel: workflowStepTone(step.status).label,
      access,
      step,
    });
  }

  return cards;
}

export function workflowCardId(stepNo: number): string {
  return `execution-${stepNo}`;
}

export function pickDefaultWorkflowCard(
  cards: WorkflowCardModel[],
  readOnly: boolean | undefined,
): WorkflowCardModel | null {
  const current = cards.find((card) => card.access === 'current_actionable');
  if (current) return current;
  if (readOnly) {
    return cards.find((card) => card.access === 'history_view_only') ?? null;
  }
  return cards.at(-1) ?? null;
}

export function resolveWorkflowSelectedCardId(params: {
  userSelectedCardId: string | null;
  initialSelectedCardId?: string | null;
  defaultCardId: string | null;
}): string | null {
  return params.userSelectedCardId ?? params.initialSelectedCardId ?? params.defaultCardId;
}
