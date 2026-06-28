/**
 * Drawer adapter for the Column Mapping review step.
 * Parses the approval payload into a MappingViewModel and renders the
 * interactive PmoMappingReviewPanel inside the drawer.
 */
import { useMemo } from 'react';
import { PmoMappingReviewPanel } from '../../../../pmo/components/pmo-mapping-review-panel';
import { usePmoMappingReviewActions } from '../../../../pmo/hooks/use-pmo-mapping-review-actions';
import type { GroupedMappingItemsBySheet } from '../../../../pmo/hooks/use-pmo-workflow-runtime';
import { parseMappingView } from '../../../../pmo/pages/pmo-page.logic';
import type { WorkflowApprovalRow } from '../../api/schemas';

function groupMappingItems(
  items: { sourceSheet: string | null; table: string; field: string }[],
): GroupedMappingItemsBySheet[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    const sheetCmp = (a.sourceSheet ?? '').localeCompare(b.sourceSheet ?? '');
    if (sheetCmp !== 0) return sheetCmp;
    const tableCmp = a.table.localeCompare(b.table);
    if (tableCmp !== 0) return tableCmp;
    return a.field.localeCompare(b.field);
  });
  const groups: GroupedMappingItemsBySheet[] = [];
  for (const item of sorted) {
    const sheetName = item.sourceSheet ?? 'Unknown sheet';
    const last = groups[groups.length - 1];
    if (!last || last.sheetName !== sheetName) {
      groups.push({ sheetName, items: [item as GroupedMappingItemsBySheet['items'][number]] });
      continue;
    }
    last.items.push(item as GroupedMappingItemsBySheet['items'][number]);
  }
  return groups;
}

export function DrawerMapping({
  approval,
  onPartialRefresh,
  onDecisionComplete,
}: {
  approval: WorkflowApprovalRow;
  onPartialRefresh: () => Promise<void> | void;
  onDecisionComplete: () => Promise<void> | void;
}) {
  const view = useMemo(() => parseMappingView(approval), [approval]);
  const groupedItems = useMemo(() => groupMappingItems(view?.items ?? []), [view]);

  const {
    editingMappingKey,
    selectedMappingAlternate,
    editingMappingItem,
    editingMappingAlternates,
    selectedAlternateOption,
    canProceedToNextStep,
    isSubmittingDecision,
    approveCurrentMappingItem,
    openMappingModify,
    applyMappingModify,
    proceedToNextWorkflowStep,
    selectMappingAlternate,
    cancelMappingModify,
  } = usePmoMappingReviewActions({
    selectedSessionId: null,
    selectedMappingApproval: approval,
    selectedMappingView: view,
    onPartialDecisionRefresh: onPartialRefresh,
    onDecisionComplete,
  });

  if (!view) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 p-4 text-body-sm text-ink-subtle">
        Could not parse mapping data from this approval.
      </div>
    );
  }

  return (
    <PmoMappingReviewPanel
      density="comfortable"
      selectedMappingApproval={approval}
      mappingApprovalsCount={1}
      groupedMappingItems={groupedItems}
      selectedMappingView={view}
      editingMappingKey={editingMappingKey}
      selectedMappingAlternate={selectedMappingAlternate}
      editingMappingItem={editingMappingItem}
      editingMappingAlternates={editingMappingAlternates}
      selectedAlternateOption={selectedAlternateOption}
      canProceedToNextStep={canProceedToNextStep}
      isSubmittingDecision={isSubmittingDecision}
      approveCurrentMappingItem={approveCurrentMappingItem}
      openMappingModify={openMappingModify}
      applyMappingModify={applyMappingModify}
      proceedToNextWorkflowStep={proceedToNextWorkflowStep}
      selectMappingAlternate={selectMappingAlternate}
      cancelMappingModify={cancelMappingModify}
    />
  );
}
