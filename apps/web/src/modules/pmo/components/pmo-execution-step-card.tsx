import type {
  PmoPlan,
  PmoPlanningSession,
  PmoProfilingArea,
  PmoProfilingReviewState,
  PmoSessionDocumentProfileRecord,
  PmoWorkbookProfilingSessionSummary,
  PmoWorkflowExecutionStepStatus,
} from '../api/client';
import type { WorkflowApprovalRow } from '../api/workflow-runtime';
import type { GroupedMappingItemsBySheet } from '../hooks/use-pmo-workflow-runtime';
import {
  type ExecutionCard,
  executionStepMatchesRuntimeStep,
  type MappingAlternateOption,
  type MappingProgressItem,
  type MappingViewModel,
  type NormalizationReviewViewModel,
  type PublishReviewViewModel,
  workflowStepTone,
} from '../pages/pmo-page.logic';
import { PmoExecutionPlanSnapshot } from './pmo-execution-plan-snapshot';
import { PmoMappingReviewPanel } from './pmo-mapping-review-panel';
import { PmoNormalizationReviewPanel } from './pmo-normalization-review-panel';
import {
  PmoProfilingDetailsPanel,
  type ProfilingOverrideEntry,
} from './pmo-profiling-details-panel';
import { PmoPublishReviewPanel } from './pmo-publish-review-panel';

export interface PmoExecutionStepRuntimeProps {
  executionCurrentStepNo: number | null;
  executionCurrentStepStatus: PmoWorkflowExecutionStepStatus | null;
  firstExecutionStepNo: number | null;
  runtimeActiveStepId: string | null;
  hasRuntimeCurrentStepMatch: boolean;
}

export interface PmoExecutionStepMappingProps {
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

export interface PmoExecutionStepNormalizationProps {
  selectedNormalizationApproval: WorkflowApprovalRow | null;
  normalizationApprovalsCount: number;
  selectedNormalizationView: NormalizationReviewViewModel | null;
  memberAdditionDrafts: Array<{
    member_id: string;
    full_name: string;
    department: string;
    role_title: string;
  }>;
  canApproveNormalization: boolean;
  isSubmittingNormalizationDecision: boolean;
  updateMemberAdditionDraft: (
    memberId: string,
    field: 'full_name' | 'department' | 'role_title',
    value: string,
  ) => void;
  updateNormalizationRowDecision: (rowId: string, decision: 'keep_row' | 'skip_row') => void;
  updateNormalizationRowValue: (rowId: string, columnKey: string, value: string) => void;
  resetNormalizationRowOverrides: (rowId: string) => void;
  approveNormalization: () => void;
  rejectNormalization: () => void;
}

export interface PmoExecutionStepPublishProps {
  selectedPublishApproval: WorkflowApprovalRow | null;
  publishApprovalsCount: number;
  selectedPublishView: PublishReviewViewModel | null;
  isSubmittingPublishDecision: boolean;
  approvePublish: () => void;
  rejectPublish: () => void;
}

export interface PmoExecutionStepProfilingProps {
  profilingReviewState: PmoProfilingReviewState | null | undefined;
  profilingSummary: PmoWorkbookProfilingSessionSummary | null | undefined;
  profilingDocuments: PmoSessionDocumentProfileRecord[];
  selectedSessionOverrides: Record<string, ProfilingOverrideEntry>;
  profilingAreas: PmoProfilingArea[];
  isAppendingDocument: boolean;
  isSavingProfilingReview: boolean;
  isApprovingProfiling: boolean;
  dropzoneAccept: string;
  dropzoneMaxBytes: number;
  handleAppendDocument: (file: File) => Promise<void>;
  handleSaveProfilingReview: () => Promise<void>;
  handleApproveProfilingContinue: () => Promise<void>;
  onSelectSheetArea: (
    documentId: string,
    sheetName: string,
    selectedArea: PmoProfilingArea,
  ) => void;
  onToggleSheetIgnore: (
    documentId: string,
    sheetName: string,
    checked: boolean,
    fallbackArea: PmoProfilingArea,
  ) => void;
}

export interface PmoExecutionStepPlanProps {
  plan: PmoPlan | null;
  goalDraft: string;
}

interface PmoExecutionStepCardProps {
  selectedSession: PmoPlanningSession;
  step: ExecutionCard;
  runtime: PmoExecutionStepRuntimeProps;
  mapping: PmoExecutionStepMappingProps;
  normalization: PmoExecutionStepNormalizationProps;
  publish: PmoExecutionStepPublishProps;
  profiling: PmoExecutionStepProfilingProps;
  plan: PmoExecutionStepPlanProps;
}

export function PmoExecutionStepCard(props: PmoExecutionStepCardProps) {
  const {
    selectedSession,
    step,
    runtime,
    mapping,
    normalization,
    publish,
    profiling,
    plan: planContext,
  } = props;

  const {
    executionCurrentStepNo,
    executionCurrentStepStatus,
    firstExecutionStepNo,
    runtimeActiveStepId,
    hasRuntimeCurrentStepMatch,
  } = runtime;

  const {
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
  } = mapping;

  const {
    selectedNormalizationApproval,
    normalizationApprovalsCount,
    selectedNormalizationView,
    memberAdditionDrafts,
    canApproveNormalization,
    isSubmittingNormalizationDecision,
    updateMemberAdditionDraft,
    updateNormalizationRowDecision,
    updateNormalizationRowValue,
    resetNormalizationRowOverrides,
    approveNormalization,
    rejectNormalization,
  } = normalization;

  const {
    selectedPublishApproval,
    publishApprovalsCount,
    selectedPublishView,
    isSubmittingPublishDecision,
    approvePublish,
    rejectPublish,
  } = publish;

  const {
    profilingReviewState,
    profilingSummary,
    profilingDocuments,
    selectedSessionOverrides,
    profilingAreas,
    isAppendingDocument,
    isSavingProfilingReview,
    isApprovingProfiling,
    dropzoneAccept,
    dropzoneMaxBytes,
    handleAppendDocument,
    handleSaveProfilingReview,
    handleApproveProfilingContinue,
    onSelectSheetArea,
    onToggleSheetIgnore,
  } = profiling;

  const { plan, goalDraft } = planContext;

  const tone = workflowStepTone(step.status);
  const isCurrentByExecutionState =
    step.step_no === (executionCurrentStepNo ?? firstExecutionStepNo) &&
    executionCurrentStepStatus !== 'cancelled';
  const useRuntimeCurrentStep = Boolean(runtimeActiveStepId) && hasRuntimeCurrentStepMatch;
  const isCurrent =
    executionCurrentStepStatus !== 'cancelled' &&
    (useRuntimeCurrentStep && runtimeActiveStepId
      ? executionStepMatchesRuntimeStep(step, runtimeActiveStepId)
      : isCurrentByExecutionState);

  const isWorkbookProfilingStep =
    step.action_id === 'workbook_profiling' ||
    step.review_type === 'profiling' ||
    /workbook\s*profil/i.test(step.step_name);
  const isLikelyMappingStep =
    step.action_id === 'column_mapping' ||
    step.review_type === 'mapping' ||
    /column\s*mapping|mapping\s*proposal|confirm\s*mapping/i.test(step.step_name);
  const isLikelyPublishStep =
    step.action_id === 'publish_after_approval' ||
    step.action_id === 'database_change_summary' ||
    step.review_type === 'publish' ||
    /publish|final\s*approval|database\s*comparison|change\s*summary|review\s*changes/i.test(
      step.step_name,
    );
  const isLikelyNormalizationStep =
    step.action_id === 'normalize_to_staging' ||
    step.review_type === 'normalization' ||
    /normaliz|staging|validate|validation|data\s*quality|duplicate|anomal/i.test(step.step_name);
  const isPlanApprovalStep = /plan\s*approval|approve\s*plan/i.test(step.step_name);
  const shouldRenderProfilingDetails = isWorkbookProfilingStep;
  const shouldRenderMappingDetails =
    isCurrent && (Boolean(selectedMappingApproval) || isLikelyMappingStep);
  const shouldRenderNormalizationDetails =
    isCurrent && Boolean(selectedNormalizationApproval) && isLikelyNormalizationStep;
  const shouldRenderPublishDetails =
    isCurrent && Boolean(selectedPublishApproval) && isLikelyPublishStep;
  const hasOpenProfilingReview =
    isWorkbookProfilingStep &&
    selectedSession.planning_state === 'approved_plan' &&
    profilingReviewState?.status === 'needs_review';
  const isProfilingPanelCurrent = isCurrent || hasOpenProfilingReview;
  const isProfilingStepReadOnly = isWorkbookProfilingStep && !isProfilingPanelCurrent;
  const isApprovedReadOnly = isProfilingStepReadOnly && profilingReviewState?.status === 'approved';

  return (
    <li className="rounded-lg border border-hairline bg-surface-1 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">
            Step {step.step_no}: {step.step_name}
          </p>
          {step.description ? <p className="mt-0.5 text-ink-subtle">{step.description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isCurrent ? (
            <span className="rounded-full bg-primary-tint px-2 py-0.5 text-caption font-medium text-primary-ink">
              Active
            </span>
          ) : null}
          <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${tone.badge}`}>
            {tone.label}
          </span>
        </div>
      </div>

      {shouldRenderProfilingDetails ? (
        <PmoProfilingDetailsPanel
          stepStatus={step.status}
          isCurrent={isProfilingPanelCurrent}
          isProfilingStepReadOnly={isProfilingStepReadOnly}
          isApprovedReadOnly={isApprovedReadOnly}
          profilingReviewState={profilingReviewState}
          profilingSummary={profilingSummary}
          profilingDocuments={profilingDocuments}
          selectedSessionOverrides={selectedSessionOverrides}
          profilingAreas={profilingAreas}
          isAppendingDocument={isAppendingDocument}
          isSavingProfilingReview={isSavingProfilingReview}
          isApprovingProfiling={isApprovingProfiling}
          canShowProfilingActions={selectedSession.planning_state === 'approved_plan'}
          dropzoneAccept={dropzoneAccept}
          dropzoneMaxBytes={dropzoneMaxBytes}
          handleAppendDocument={handleAppendDocument}
          handleSaveProfilingReview={handleSaveProfilingReview}
          handleApproveProfilingContinue={handleApproveProfilingContinue}
          onSelectSheetArea={onSelectSheetArea}
          onToggleSheetIgnore={onToggleSheetIgnore}
        />
      ) : shouldRenderMappingDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Column mapping proposal</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <PmoMappingReviewPanel
            selectedMappingApproval={selectedMappingApproval}
            mappingApprovalsCount={mappingApprovalsCount}
            groupedMappingItems={groupedMappingItems}
            selectedMappingView={selectedMappingView}
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
        </div>
      ) : shouldRenderNormalizationDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Normalization validation</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <PmoNormalizationReviewPanel
            selectedNormalizationApproval={selectedNormalizationApproval}
            normalizationApprovalsCount={normalizationApprovalsCount}
            selectedNormalizationView={selectedNormalizationView}
            memberAdditionDrafts={memberAdditionDrafts}
            canApproveNormalization={canApproveNormalization}
            isSubmittingNormalizationDecision={isSubmittingNormalizationDecision}
            updateMemberAdditionDraft={updateMemberAdditionDraft}
            updateNormalizationRowDecision={updateNormalizationRowDecision}
            updateNormalizationRowValue={updateNormalizationRowValue}
            resetNormalizationRowOverrides={resetNormalizationRowOverrides}
            approveNormalization={approveNormalization}
            rejectNormalization={rejectNormalization}
          />
        </div>
      ) : shouldRenderPublishDetails ? (
        <div className="mt-2 space-y-2 rounded-md border border-hairline bg-canvas p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-ink">Publish review</p>
            <span
              className={`rounded-full px-2 py-0.5 text-caption font-medium ${workflowStepTone(step.status).badge}`}
            >
              {workflowStepTone(step.status).label}
            </span>
          </div>

          <PmoPublishReviewPanel
            selectedPublishApproval={selectedPublishApproval}
            publishApprovalsCount={publishApprovalsCount}
            selectedPublishView={selectedPublishView}
            isSubmittingPublishDecision={isSubmittingPublishDecision}
            approvePublish={approvePublish}
            rejectPublish={rejectPublish}
          />
        </div>
      ) : isPlanApprovalStep ? (
        <PmoExecutionPlanSnapshot
          selectedSession={selectedSession}
          plan={plan}
          goalDraft={goalDraft}
        />
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-hairline-strong bg-canvas px-2 py-1.5 text-ink-subtle">
          This step is planned and read-only for now. Implementation will be added in subsequent
          iteration.
        </p>
      )}
    </li>
  );
}
