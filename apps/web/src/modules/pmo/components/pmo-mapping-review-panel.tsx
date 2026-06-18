import { Button } from '@seta/shared-ui';
import { Fragment } from 'react';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { GroupedMappingItemsBySheet } from '../hooks/use-pmo-workflow-runtime';
import {
  type MappingAlternateOption,
  type MappingProgressItem,
  type MappingViewModel,
  shortId,
  splitSheetAndColumn,
} from '../pages/pmo-page.logic';

interface PmoMappingReviewPanelProps {
  readOnly?: boolean;
  selectedMappingApproval: WorkflowApprovalRow | null;
  mappingApprovalsCount: number;
  groupedMappingItems: GroupedMappingItemsBySheet[];
  selectedMappingView: MappingViewModel | null;
  editingMappingKey: string | null;
  selectedMappingAlternate: number | null;
  editingMappingItem: MappingProgressItem | null;
  editingMappingAlternates: MappingAlternateOption[];
  selectedAlternateOption: MappingAlternateOption | null;
  canProceedToNextStep: boolean;
  isSubmittingDecision: boolean;
  approveCurrentMappingItem: () => void;
  openMappingModify: (itemKey: string) => void;
  applyMappingModify: () => void;
  proceedToNextWorkflowStep: () => void;
  selectMappingAlternate: (alternateIndex: number) => void;
  cancelMappingModify: () => void;
}

export function PmoMappingReviewPanel(props: PmoMappingReviewPanelProps) {
  const {
    readOnly = false,
    selectedMappingApproval,
    mappingApprovalsCount,
    groupedMappingItems,
    selectedMappingView,
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
  } = props;

  if (!selectedMappingApproval) {
    return (
      <p className="text-ink-subtle">
        {mappingApprovalsCount > 0
          ? 'Found pending mapping approvals, but they are not linked to the currently selected session. Try Refresh or select a different session.'
          : 'No pending column mapping proposal for this session.'}
      </p>
    );
  }

  return (
    <>
      {readOnly ? (
        <div className="rounded-lg border border-hairline bg-surface-2/60 px-3 py-2 text-caption text-ink-subtle">
          This mapping review has been completed. Showing historical data (read-only).
        </div>
      ) : (
        <div className="rounded-lg border border-warning-border bg-warning-tint/80 px-3 py-2 text-caption text-warning-ink">
          Mapping review is required. The workflow proceeds only after all mapping items are
          approved and you click Next step.
        </div>
      )}

      <section className="rounded-lg border border-hairline bg-surface-1 p-3">
        <h4 className="text-body-sm font-semibold text-ink">Review column mappings</h4>
        <p className="mt-1 text-caption text-ink-subtle">
          Approve each mapping item individually. The workflow proceeds only after all mapping items
          are approved and you click Next step.
        </p>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-caption">
            <thead className="border-b border-hairline text-ink-subtle">
              <tr>
                <th className="px-2 py-1.5">Source column</th>
                <th className="px-2 py-1.5">Target DB column</th>
                <th className="px-2 py-1.5">Issue type</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Approved by</th>
                <th className="px-2 py-1.5">Confidence score</th>
                <th className="px-2 py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedMappingItems.length ? (
                groupedMappingItems.map((group) => (
                  <Fragment key={group.sheetName}>
                    <tr className="border-b border-hairline bg-surface-2/60">
                      <td
                        className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
                        colSpan={7}
                      >
                        Sheet: {group.sheetName}
                      </td>
                    </tr>

                    {group.items.map((item) => {
                      const alternatesForItem =
                        selectedMappingView?.alternatesByItemKey.get(item.key) ?? [];
                      const canApprove =
                        item.actionType === 'approve_and_modify' &&
                        item.state === 'current' &&
                        !isSubmittingDecision;
                      const canModify = alternatesForItem.length > 0 && !isSubmittingDecision;
                      const isEditingItem = editingMappingKey === item.key;

                      return (
                        <Fragment key={item.key}>
                          <tr className="border-b border-hairline last:border-b-0">
                            <td className="px-2 py-1.5 font-medium text-ink">
                              {item.sourceColumn ?? item.key}
                            </td>
                            <td className="px-2 py-1.5 text-primary-ink">
                              dim_{item.table}.{item.field}
                            </td>
                            <td className="px-2 py-1.5 text-ink-subtle">{item.issueType || '-'}</td>
                            <td className="px-2 py-1.5">
                              {item.state === 'approved' ? (
                                <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-ink">
                                  Approved
                                </span>
                              ) : (
                                <span className="rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-ink">
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-ink-subtle">
                              {item.approvedBy ? shortId(item.approvedBy) : '-'}
                            </td>
                            <td className="px-2 py-1.5 text-ink-subtle">
                              {item.confidence ?? '-'}
                            </td>
                            <td className="px-2 py-1.5">
                              {readOnly ? (
                                <span className="text-ink-subtle">-</span>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {item.actionType === 'approve_and_modify' ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      disabled={!canApprove}
                                      onClick={approveCurrentMappingItem}
                                    >
                                      {isSubmittingDecision && item.state === 'current'
                                        ? 'Approving...'
                                        : 'Approve'}
                                    </Button>
                                  ) : null}
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    type="button"
                                    disabled={!canModify}
                                    onClick={() => openMappingModify(item.key)}
                                  >
                                    Modify
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>

                          {isEditingItem ? (
                            <tr className="border-b border-hairline bg-canvas/60">
                              <td colSpan={7} className="px-2 py-2">
                                <div className="rounded-md border border-hairline bg-canvas p-3">
                                  <p className="text-caption font-medium text-ink">
                                    Modify current mapping
                                  </p>
                                  <p className="mt-1 text-caption text-ink-subtle">
                                    Modify only changes the source column from sheet data. Target DB
                                    column stays dim_{item.table}.{item.field}.
                                  </p>

                                  <div className="mt-2 space-y-2">
                                    <p className="text-caption text-ink-subtle">
                                      Candidate source mapping
                                    </p>

                                    <div className="space-y-1.5">
                                      {editingMappingAlternates.map((option) => {
                                        const isSelected =
                                          selectedMappingAlternate === option.alternateIndex;
                                        const { sheetName, columnName } = splitSheetAndColumn(
                                          option.sourceColumn,
                                          editingMappingItem?.sourceSheet ?? item.sourceSheet,
                                        );

                                        return (
                                          <button
                                            key={option.alternateIndex}
                                            type="button"
                                            className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left transition-colors ${
                                              isSelected
                                                ? 'border-primary bg-primary-tint/40'
                                                : 'border-hairline bg-canvas hover:bg-surface-1'
                                            }`}
                                            onClick={() => {
                                              selectMappingAlternate(option.alternateIndex);
                                            }}
                                            disabled={isSubmittingDecision}
                                          >
                                            <span className="font-mono text-body-sm">
                                              <span className="text-danger-ink">{sheetName}</span>
                                              <span className="text-ink-subtle">.</span>
                                              <span className="text-primary-ink">{columnName}</span>
                                            </span>

                                            <span className="text-caption text-ink-subtle">
                                              {option.confidence
                                                ? option.confidence
                                                : 'confidence -'}
                                              {option.blocked ? ' • blocked' : ''}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  <div className="mt-2 flex flex-wrap items-end gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="primary"
                                      disabled={
                                        selectedMappingAlternate === null || isSubmittingDecision
                                      }
                                      onClick={applyMappingModify}
                                    >
                                      {isSubmittingDecision ? 'Applying...' : 'Apply change'}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      disabled={isSubmittingDecision}
                                      onClick={cancelMappingModify}
                                    >
                                      Cancel
                                    </Button>
                                  </div>

                                  {selectedAlternateOption
                                    ? (() => {
                                        const { sheetName, columnName } = splitSheetAndColumn(
                                          selectedAlternateOption.sourceColumn,
                                          editingMappingItem?.sourceSheet ?? item.sourceSheet,
                                        );

                                        return (
                                          <p className="mt-2 text-caption text-ink-subtle">
                                            Selected:{' '}
                                            <span className="font-mono">
                                              <span className="text-danger-ink">{sheetName}</span>
                                              <span className="text-ink-subtle">.</span>
                                              <span className="text-primary-ink">{columnName}</span>
                                            </span>
                                            {selectedAlternateOption.confidence
                                              ? ` (${selectedAlternateOption.confidence})`
                                              : ''}
                                            {selectedAlternateOption.blocked
                                              ? ' • blocked candidate'
                                              : ''}
                                          </p>
                                        );
                                      })()
                                    : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td className="px-2 py-2 text-ink-subtle" colSpan={7}>
                    No mapping review item for this session.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-canvas p-3">
          <p className="text-caption text-ink-subtle">
            {selectedMappingView?.approved ?? 0} of {selectedMappingView?.total ?? 0} mapping review
            items approved.
          </p>
          {readOnly ? null : (
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="ml-auto"
              onClick={proceedToNextWorkflowStep}
              disabled={!canProceedToNextStep}
            >
              {isSubmittingDecision && canProceedToNextStep ? 'Processing...' : 'Next step'}
            </Button>
          )}
        </div>
      </section>
    </>
  );
}
