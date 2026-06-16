import {
  buildMappingItemReviewCard,
  buildMappingReviewRows,
  collectMappingDisplayItems,
  collectMappingReviewItems,
  type MappingOverride,
} from '../cards.ts';
import type { PmoDynamicStepHandler } from '../types.ts';
import type { DetectTableMapping, DynamicHandlerDeps, MappingReviewRow } from './common.ts';

export function createColumnMappingHandler(
  deps: Pick<
    DynamicHandlerDeps,
    'resolveCardIdentity' | 'readPlannerStepMeta' | 'applyMappingOverrides'
  >,
): PmoDynamicStepHandler {
  return {
    actionId: 'column_mapping',
    execute: async (input) => {
      if (!input.runtimeContext.detected_schema) {
        throw new Error('v2_detected_schema_missing');
      }

      const detected = input.runtimeContext.detected_schema;
      const tableMappings = detected.tableMappings as DetectTableMapping[];
      const reviewItems = collectMappingReviewItems(tableMappings);
      const displayItems = collectMappingDisplayItems(tableMappings, reviewItems);
      const actorUserId = deps.resolveCardIdentity(input.requestContext).userId;
      const plannerStep = await deps.readPlannerStepMeta({
        ingestionSessionId: input.ingestionSessionId,
        tenantId: input.tenantId,
        step: input.step,
      });

      if (!input.resumeData) {
        if (detected.validationStatus === 'confirmed' || reviewItems.length === 0) {
          const mappingReviewRows: MappingReviewRow[] = buildMappingReviewRows({
            displayItems,
            reviewItems,
            approvedItemIds: reviewItems.map((item) => item.id),
            approvedByByItemKey: {},
            fallbackApprovedBy: actorUserId,
            currentItemId: null,
            awaitingNextStep: true,
          });

          return {
            kind: 'completed',
            sessionStatus: 'confirmed',
            runtimeContextPatch: {
              confirmed_mapping: {
                confirmedMappings: tableMappings,
                mappingReviewRows,
              },
            },
            sessionPatch: {
              confirmed_mapping: {
                confirmedMappings: tableMappings,
                mappingReviewRows,
              },
            },
            outputSummary: {
              status: 'auto_confirmed',
              approved_items: reviewItems.length,
            },
          };
        }

        const firstItem = reviewItems[0];
        if (!firstItem) throw new Error('mapping_review_items_empty');

        return {
          kind: 'suspend',
          card: buildMappingItemReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            workbookConfidence: detected.workbookConfidence,
            validationStatus: detected.validationStatus,
            tableMappings,
            reviewItems,
            approvedItemIds: [],
            approvedByByItemKey: {},
            mappingOverrides: [],
            currentItemId: firstItem.id,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmMapping`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_confirmation',
          outputSummary: {
            status: 'needs_review',
            total_items: reviewItems.length,
          },
        };
      }

      if (input.resumeData.decision === 'reject') {
        return {
          kind: 'rejected',
          sessionStatus: 'rejected',
          outputSummary: { status: 'rejected' },
          terminalOutput: {
            ingestionSessionId: input.ingestionSessionId,
            status: 'rejected',
            rowsWritten: {},
            rowsUpdated: {},
            rowsSkipped: {},
          },
        };
      }

      const overrideList =
        (input.resumeData.mappingOverrides as MappingOverride[] | undefined) ?? [];
      const mergedOverrides = (() => {
        const byKey = new Map<string, MappingOverride>();
        for (const override of overrideList) {
          byKey.set(`${override.tableId}|${override.field}`, override);
        }
        const single = input.resumeData.mappingOverride as MappingOverride | undefined;
        if (single) {
          byKey.set(`${single.tableId}|${single.field}`, single);
        }
        return [...byKey.values()];
      })();

      const effectiveMappings = deps.applyMappingOverrides(tableMappings, mergedOverrides);
      const effectiveReviewItems = collectMappingReviewItems(effectiveMappings);
      const effectiveDisplayItems = collectMappingDisplayItems(
        effectiveMappings,
        effectiveReviewItems,
      );
      const approvedByByItemKey: Record<string, string> = {
        ...((input.resumeData.approvedByByItemKey as Record<string, string> | undefined) ?? {}),
      };

      const validIds = new Set(effectiveReviewItems.map((item) => item.id));
      const approved = new Set<string>();
      for (const id of (input.resumeData.approvedItemKeys as string[] | undefined) ?? []) {
        if (validIds.has(id)) approved.add(id);
      }
      if (
        typeof input.resumeData.approvedItemKey === 'string' &&
        validIds.has(input.resumeData.approvedItemKey)
      ) {
        approved.add(input.resumeData.approvedItemKey);
        if (input.resumeData.decision === 'approve' && actorUserId) {
          approvedByByItemKey[input.resumeData.approvedItemKey] = actorUserId;
        }
      }

      if (effectiveReviewItems.length > 0 && approved.size < effectiveReviewItems.length) {
        const nextItem = effectiveReviewItems.find((item) => !approved.has(item.id));
        if (!nextItem) throw new Error('next_mapping_item_not_found');

        return {
          kind: 'suspend',
          card: buildMappingItemReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            workbookConfidence: detected.workbookConfidence,
            validationStatus: detected.validationStatus,
            tableMappings: effectiveMappings,
            reviewItems: effectiveReviewItems,
            approvedItemIds: [...approved],
            approvedByByItemKey,
            mappingOverrides: mergedOverrides,
            currentItemId: nextItem.id,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmMapping`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_confirmation',
          outputSummary: {
            status: 'needs_review',
            remaining_items: effectiveReviewItems.length - approved.size,
          },
        };
      }

      if (effectiveReviewItems.length > 0 && input.resumeData.proceedToNextStep !== true) {
        const firstItem = effectiveReviewItems[0];
        if (!firstItem) throw new Error('mapping_review_items_empty');

        return {
          kind: 'suspend',
          card: buildMappingItemReviewCard({
            ingestionSessionId: input.ingestionSessionId,
            workbookConfidence: detected.workbookConfidence,
            validationStatus: detected.validationStatus,
            tableMappings: effectiveMappings,
            reviewItems: effectiveReviewItems,
            approvedItemIds: [...approved],
            approvedByByItemKey,
            mappingOverrides: mergedOverrides,
            currentItemId: firstItem.id,
            awaitingNextStep: true,
            identity: deps.resolveCardIdentity(input.requestContext),
            toolCallId: `workflow:${input.runId}:pmo_confirmMapping`,
            plannerStep,
          }),
          sessionStatus: 'awaiting_confirmation',
          outputSummary: {
            status: 'awaiting_next_step',
            approved_items: approved.size,
          },
        };
      }

      const mappingReviewRows: MappingReviewRow[] = buildMappingReviewRows({
        displayItems: effectiveDisplayItems,
        reviewItems: effectiveReviewItems,
        approvedItemIds: effectiveReviewItems.map((item) => item.id),
        approvedByByItemKey,
        fallbackApprovedBy: actorUserId,
        currentItemId: null,
        awaitingNextStep: true,
      });

      return {
        kind: 'completed',
        sessionStatus: 'confirmed',
        runtimeContextPatch: {
          confirmed_mapping: {
            confirmedMappings: effectiveMappings,
            mappingReviewRows,
          },
        },
        sessionPatch: {
          confirmed_mapping: {
            confirmedMappings: effectiveMappings,
            mappingReviewRows,
          },
        },
        outputSummary: {
          status: 'confirmed',
          approved_items: effectiveReviewItems.length,
        },
      };
    },
  };
}
