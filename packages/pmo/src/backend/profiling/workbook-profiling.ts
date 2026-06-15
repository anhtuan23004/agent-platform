import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { detectSheetRoles } from '../ingestion/detect-sheet-role.ts';
import { parseWorkbook } from '../ingestion/parse-workbook.ts';
import { profileColumns } from '../ingestion/profile-columns.ts';

export const ProfilingAreaSchema = z.enum([
  'resource_allocation',
  'timesheet',
  'member_master',
  'project_master',
  'leave',
  'holiday',
  'training',
  'unknown',
]);

export type ProfilingArea = z.infer<typeof ProfilingAreaSchema>;
export type KnownProfilingArea = Exclude<ProfilingArea, 'unknown'>;
type InterpretationConfidence = 'low' | 'medium' | 'high';
type MissingAreaSource = 'goal_rule' | 'llm_interpretation' | 'combined';
type SheetDecisionSource =
  | 'deterministic_only'
  | 'deterministic_and_llm_agree'
  | 'deterministic_conflict_with_llm'
  | 'llm_only'
  | 'user_override'
  | 'unresolved';

export interface ProfilingSheetReviewOverride {
  document_id: string;
  sheet_name: string;
  final_area: ProfilingArea;
  mark_ignore: boolean;
}

export interface ProfilingReviewState {
  status: 'needs_review' | 'approved';
  sheet_overrides: ProfilingSheetReviewOverride[];
  waived_missing_areas: KnownProfilingArea[];
  last_updated_at: string;
  approved_at?: string;
  approved_by?: string;
}

export interface WorkbookSheetDeterministicDetection {
  candidate_area: ProfilingArea;
  confidence: number;
  evidence: string[];
}

export interface WorkbookSheetLlmInterpretation {
  probable_area: ProfilingArea | 'ignore';
  confidence: InterpretationConfidence;
  rationale: string;
  recommended_action: 'process' | 'review' | 'ignore';
}

export interface WorkbookSheetFinalDecision {
  area: ProfilingArea;
  confidence: InterpretationConfidence;
  source: SheetDecisionSource;
  requires_user_review: boolean;
}

export interface MissingRecommendedDataAreaDetail {
  data_area: KnownProfilingArea;
  source: MissingAreaSource;
  reason: string;
  confidence: InterpretationConfidence;
}

const InterpretationAreaSchema = ProfilingAreaSchema.or(z.literal('ignore'));

const WorkbookProfileInterpretationSchema = z.object({
  summary: z.string().min(1),
  next_step_recommendation: z.string().min(1),
  missing_recommended_data_areas: z.array(ProfilingAreaSchema),
  sheet_interpretations: z.array(
    z.object({
      sheet_name: z.string().min(1),
      probable_area: InterpretationAreaSchema,
      confidence: z.enum(['low', 'medium', 'high']),
      rationale: z.string().min(1),
      recommended_action: z.enum(['process', 'review', 'ignore']),
    }),
  ),
});

type WorkbookProfileInterpretation = z.infer<typeof WorkbookProfileInterpretationSchema>;

export interface WorkbookSheetProfileSummary {
  sheet_name: string;
  row_count: number;
  column_count: number;
  header_row: number;
  candidate_business_area: ProfilingArea;
  confidence: number;
  likely_purpose: string;
  key_columns: string[];
  sample_value_patterns: string[];
  deterministic_detection: WorkbookSheetDeterministicDetection;
  llm_interpretation?: WorkbookSheetLlmInterpretation;
  final_decision: WorkbookSheetFinalDecision;
}

export interface WorkbookProfilingDocumentResult {
  workbook_summary: {
    file_name: string;
    file_size_bytes: number | null;
    mime_type: string;
    uploaded_at: string;
    sheet_count: number;
    total_rows: number;
    total_columns: number;
    excluded_sheets: string[];
    parse_errors: string[];
  };
  sheets: WorkbookSheetProfileSummary[];
  detected_data_areas: ProfilingArea[];
  recommendations: {
    missing_recommended_data_areas: ProfilingArea[];
    missing_recommended_data_areas_details: MissingRecommendedDataAreaDetail[];
    likely_ignorable_sheets: string[];
    suggested_next_step: string;
  };
  generated_at: string;
}

export interface SessionDocumentProfileRecord {
  document_id: string;
  source_file_key: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string;
  uploaded_at: string;
  status: 'uploaded' | 'profiling' | 'profiled' | 'profile_failed';
  profile_result?: WorkbookProfilingDocumentResult;
  error_message?: string;
}

export type WorkflowExecutionStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'needs_review'
  | 'failed';

export interface WorkflowExecutionStep {
  step_no: number;
  step_name: string;
  status: WorkflowExecutionStepStatus;
}

export interface WorkflowExecutionState {
  state_version: 1;
  started_at: string;
  updated_at: string;
  current_step_no: number;
  current_step_status: 'in_progress' | 'needs_review' | 'completed' | 'failed';
  steps: WorkflowExecutionStep[];
  documents: SessionDocumentProfileRecord[];
  profiling_summary: WorkbookProfilingSessionSummary | null;
  profiling_review: ProfilingReviewState | null;
}

export interface WorkbookProfilingSessionSummary {
  generated_at: string;
  document_count: number;
  profiled_document_count: number;
  total_sheet_count: number;
  total_row_count: number;
  detected_data_areas: ProfilingArea[];
  missing_recommended_data_areas: ProfilingArea[];
  missing_recommended_data_areas_details: MissingRecommendedDataAreaDetail[];
  likely_ignorable_sheets: string[];
  suggested_next_step: string;
}

export interface RunWorkbookProfilingInput {
  goal: string;
  fileBuffer: Buffer | ArrayBuffer | Uint8Array;
  fileName: string;
  fileSizeBytes: number | null;
  mimeType: string;
  uploadedAt: string;
}

const PROFILE_INTERPRETATION_PROMPT = `You are a PMO workbook profiling interpreter.

You will receive a deterministic workbook profile containing sheet names, row and column counts, header rows, key columns, and value patterns.

Your job:
1. Infer likely business meaning of each sheet.
2. Suggest which data areas may be missing for the stated goal.
3. Mark sheets that can likely be ignored.
4. Provide cautious recommendations (not final conclusions).

Constraints:
- Do not claim certainty when evidence is weak.
- Do not invent columns or sheet names that are not in the input.
- Treat outputs as recommendations only.
- Keep recommendations practical and concise.

Return only structured output.`;

function resolveProfilingModel(): string {
  const direct = process.env.PMO_PLAN_MODEL?.trim();
  if (direct) {
    return direct;
  }

  const defaultModel = process.env.AGENT_MODEL_DEFAULT?.trim();
  if (defaultModel && defaultModel !== 'auto') {
    return defaultModel;
  }

  const catalogRaw = process.env.AGENT_MODELS?.trim();
  if (catalogRaw) {
    const first = catalogRaw
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)[0];

    if (first) {
      const tierSuffixMatch = first.match(/:(fast|balanced|reasoning)$/);
      if (tierSuffixMatch) {
        return first.slice(0, -tierSuffixMatch[0].length);
      }
      return first;
    }
  }

  return 'openai/gpt-5.5';
}

function mapRoleToArea(role: string | null | undefined): ProfilingArea {
  if (!role) {
    return 'unknown';
  }

  if (role === 'resource_allocation') return 'resource_allocation';
  if (role === 'timesheet') return 'timesheet';
  if (role === 'member_master') return 'member_master';
  if (role === 'project_master') return 'project_master';
  if (role === 'leave') return 'leave';
  if (role === 'calendar_weeks') return 'holiday';
  return 'unknown';
}

function inferGoalAreas(goal: string): ProfilingArea[] {
  const normalized = goal.toLowerCase();
  const expected = new Set<ProfilingArea>();

  if (/ra|allocation|capacity|resource/.test(normalized)) expected.add('resource_allocation');
  if (/timesheet|logged|actual|effort|utilization|utilisation/.test(normalized)) {
    expected.add('timesheet');
  }
  if (/member|employee|staff|nhan su|nhân sự/.test(normalized)) expected.add('member_master');
  if (/project|du an|dự án|engagement/.test(normalized)) expected.add('project_master');
  if (/leave|holiday|absence|nghi phep|nghỉ phép/.test(normalized)) {
    expected.add('leave');
    expected.add('holiday');
  }
  if (/training|learning|upskill/.test(normalized)) expected.add('training');

  // Keep fallback neutral when goal is vague instead of forcing RA assumptions.
  if (expected.size === 0) {
    return [];
  }

  if (
    expected.has('resource_allocation') &&
    /compare|variance|planned.*actual|actual.*planned/.test(normalized)
  ) {
    expected.add('timesheet');
  }

  return [...expected];
}

function confidenceBandFromScore(score: number): InterpretationConfidence {
  if (score >= 0.8) {
    return 'high';
  }

  if (score >= 0.55) {
    return 'medium';
  }

  return 'low';
}

function strongerConfidence(
  left: InterpretationConfidence,
  right: InterpretationConfidence,
): InterpretationConfidence {
  const rank: Record<InterpretationConfidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return rank[left] >= rank[right] ? left : right;
}

function knownAreaOrNull(area: ProfilingArea | 'ignore'): KnownProfilingArea | null {
  if (area === 'ignore' || area === 'unknown') {
    return null;
  }

  return area;
}

function buildFinalDecision(params: {
  deterministicArea: ProfilingArea;
  deterministicConfidence: number;
  llmInterpretation?: WorkbookSheetLlmInterpretation;
}): WorkbookSheetFinalDecision {
  const deterministicBand = confidenceBandFromScore(params.deterministicConfidence);
  const llmArea = params.llmInterpretation
    ? knownAreaOrNull(params.llmInterpretation.probable_area)
    : null;

  if (!params.llmInterpretation) {
    return {
      area: params.deterministicArea,
      confidence: deterministicBand,
      source: params.deterministicArea === 'unknown' ? 'unresolved' : 'deterministic_only',
      requires_user_review:
        params.deterministicArea === 'unknown' || params.deterministicConfidence < 0.55,
    };
  }

  if (params.deterministicArea === 'unknown') {
    if (llmArea) {
      return {
        area: llmArea,
        confidence: params.llmInterpretation.confidence,
        source: 'llm_only',
        requires_user_review: true,
      };
    }

    return {
      area: 'unknown',
      confidence: params.llmInterpretation.confidence,
      source: 'unresolved',
      requires_user_review: true,
    };
  }

  if (!llmArea) {
    return {
      area: params.deterministicArea,
      confidence: deterministicBand,
      source: 'deterministic_only',
      requires_user_review: params.llmInterpretation.recommended_action === 'review',
    };
  }

  if (llmArea === params.deterministicArea) {
    return {
      area: params.deterministicArea,
      confidence: strongerConfidence(deterministicBand, params.llmInterpretation.confidence),
      source: 'deterministic_and_llm_agree',
      requires_user_review: params.llmInterpretation.recommended_action === 'review',
    };
  }

  return {
    area: params.deterministicArea,
    confidence: deterministicBand,
    source: 'deterministic_conflict_with_llm',
    requires_user_review: true,
  };
}

function toIsoOrNow(input: string): string {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

async function maybeInterpretWorkbookProfile(input: {
  goal: string;
  workbook_summary: WorkbookProfilingDocumentResult['workbook_summary'];
  sheets: WorkbookSheetProfileSummary[];
}): Promise<WorkbookProfileInterpretation | null> {
  try {
    const interpreter = new Agent({
      id: 'pmo.workbookProfileInterpreter',
      name: 'PMO Workbook Profile Interpreter',
      instructions: PROFILE_INTERPRETATION_PROMPT,
      model: resolveProfilingModel(),
    });

    const result = await interpreter.generate(JSON.stringify(input), {
      structuredOutput: { schema: WorkbookProfileInterpretationSchema },
      providerOptions: { openai: { reasoningSummary: 'auto' } },
    });

    return result.object ?? null;
  } catch (error) {
    console.warn('[pmo/profiling] interpretation skipped:', error);
    return null;
  }
}

export async function runWorkbookProfiling(
  input: RunWorkbookProfilingInput,
): Promise<WorkbookProfilingDocumentResult> {
  const parseResult = await parseWorkbook(input.fileBuffer);
  const sheetProfiles = parseResult.sheets.map((sheet) => profileColumns(sheet));
  const roleDetections = detectSheetRoles(sheetProfiles);

  const sheets: WorkbookSheetProfileSummary[] = sheetProfiles.map((sheetProfile, index) => {
    const role = roleDetections[index]?.topCandidate;
    const candidateArea = mapRoleToArea(role?.candidateRole);
    const confidence = role?.confidence ?? 0;
    const keyColumns = sheetProfile.columns
      .slice()
      .sort((a, b) => b.uniqueRate - a.uniqueRate)
      .slice(0, 5)
      .map((column) => column.columnName);
    const sampleValuePatterns = sheetProfile.columns
      .map((column) => column.valuePattern)
      .filter((pattern): pattern is string => Boolean(pattern))
      .slice(0, 5);

    const defaultPurpose =
      candidateArea === 'unknown'
        ? 'Sheet purpose is unclear and may require user confirmation.'
        : `Likely related to ${candidateArea.replace('_', ' ')} data.`;

    const deterministicEvidence: string[] = [];
    if (role?.candidateRole) {
      deterministicEvidence.push(
        `role_detector_top_candidate=${role.candidateRole} (confidence=${role.confidence.toFixed(2)})`,
      );
    }

    if (keyColumns.length > 0) {
      deterministicEvidence.push(`key_columns=${keyColumns.slice(0, 3).join(', ')}`);
    }

    if (sampleValuePatterns.length > 0) {
      deterministicEvidence.push(`value_patterns=${sampleValuePatterns.slice(0, 2).join(', ')}`);
    }

    const deterministicDetection: WorkbookSheetDeterministicDetection = {
      candidate_area: candidateArea,
      confidence,
      evidence: deterministicEvidence,
    };

    const finalDecision = buildFinalDecision({
      deterministicArea: candidateArea,
      deterministicConfidence: confidence,
    });

    return {
      sheet_name: sheetProfile.sheetName,
      row_count: sheetProfile.rowCount,
      column_count: sheetProfile.columns.length,
      header_row: sheetProfile.headerRow,
      candidate_business_area: candidateArea,
      confidence,
      likely_purpose: defaultPurpose,
      key_columns: keyColumns,
      sample_value_patterns: sampleValuePatterns,
      deterministic_detection: deterministicDetection,
      final_decision: finalDecision,
    };
  });

  const likelyIgnorableSheets = [
    ...new Set([
      ...parseResult.excludedSheets,
      ...sheets
        .filter((sheet) => sheet.candidate_business_area === 'unknown' && sheet.row_count <= 3)
        .map((sheet) => sheet.sheet_name),
    ]),
  ];

  const workbookSummary: WorkbookProfilingDocumentResult['workbook_summary'] = {
    file_name: input.fileName,
    file_size_bytes: input.fileSizeBytes,
    mime_type: input.mimeType,
    uploaded_at: toIsoOrNow(input.uploadedAt),
    sheet_count: sheets.length,
    total_rows: sheets.reduce((sum, sheet) => sum + sheet.row_count, 0),
    total_columns: sheets.reduce((sum, sheet) => sum + sheet.column_count, 0),
    excluded_sheets: parseResult.excludedSheets,
    parse_errors: parseResult.parseErrors,
  };

  const interpretation = await maybeInterpretWorkbookProfile({
    goal: input.goal,
    workbook_summary: workbookSummary,
    sheets,
  });

  const interpretationBySheet = new Map(
    (interpretation?.sheet_interpretations ?? []).map((entry) => [entry.sheet_name, entry]),
  );

  for (const sheet of sheets) {
    const interpreted = interpretationBySheet.get(sheet.sheet_name);
    if (!interpreted) {
      continue;
    }

    const llmInterpretation: WorkbookSheetLlmInterpretation = {
      probable_area: interpreted.probable_area,
      confidence: interpreted.confidence,
      rationale: interpreted.rationale,
      recommended_action: interpreted.recommended_action,
    };

    sheet.llm_interpretation = llmInterpretation;
    sheet.likely_purpose = interpreted.rationale;
    sheet.final_decision = buildFinalDecision({
      deterministicArea: sheet.deterministic_detection.candidate_area,
      deterministicConfidence: sheet.deterministic_detection.confidence,
      llmInterpretation,
    });
  }

  const detectedDataAreas: KnownProfilingArea[] = [
    ...new Set(sheets.map((sheet) => sheet.final_decision.area)),
  ].filter((area): area is KnownProfilingArea => area !== 'unknown');

  const expectedAreas = inferGoalAreas(input.goal).filter(
    (area): area is KnownProfilingArea => area !== 'unknown',
  );

  const missingByArea = new Map<KnownProfilingArea, MissingRecommendedDataAreaDetail>();
  for (const area of expectedAreas) {
    if (!detectedDataAreas.includes(area)) {
      missingByArea.set(area, {
        data_area: area,
        source: 'goal_rule',
        reason: 'Area inferred from goal keywords but not found in final sheet decisions.',
        confidence: 'medium',
      });
    }
  }

  if (interpretation) {
    const interpretedIgnorable = interpretation.sheet_interpretations
      .filter((entry) => entry.recommended_action === 'ignore' || entry.probable_area === 'ignore')
      .map((entry) => entry.sheet_name);

    for (const ignoredSheet of interpretedIgnorable) {
      if (!likelyIgnorableSheets.includes(ignoredSheet)) {
        likelyIgnorableSheets.push(ignoredSheet);
      }
    }

    for (const area of interpretation.missing_recommended_data_areas) {
      if (area === 'unknown') {
        continue;
      }

      const existing = missingByArea.get(area);
      if (existing) {
        missingByArea.set(area, {
          ...existing,
          source: 'combined',
          reason:
            `${existing.reason} LLM interpretation also suggests this area may be missing.`.trim(),
          confidence: strongerConfidence(existing.confidence, 'medium'),
        });
      } else {
        missingByArea.set(area, {
          data_area: area,
          source: 'llm_interpretation',
          reason: 'Suggested by LLM interpretation as potentially missing workbook context.',
          confidence: 'medium',
        });
      }
    }
  }

  const missingRecommendedDetails = [...missingByArea.values()];
  const missingRecommended = missingRecommendedDetails.map((entry) => entry.data_area);

  return {
    workbook_summary: workbookSummary,
    sheets,
    detected_data_areas: detectedDataAreas,
    recommendations: {
      missing_recommended_data_areas: missingRecommended,
      missing_recommended_data_areas_details: missingRecommendedDetails,
      likely_ignorable_sheets: likelyIgnorableSheets,
      suggested_next_step:
        interpretation?.next_step_recommendation ??
        (missingRecommended.length > 0
          ? `Consider uploading supplemental sheets for: ${missingRecommended.join(', ')}.`
          : 'Workbook profiling is complete. Continue to sheet role detection and mapping proposal.'),
    },
    generated_at: new Date().toISOString(),
  };
}

export function buildWorkbookProfilingSessionSummary(
  documents: SessionDocumentProfileRecord[],
): WorkbookProfilingSessionSummary {
  const profiledResults = documents
    .filter(
      (
        doc,
      ): doc is SessionDocumentProfileRecord & {
        profile_result: WorkbookProfilingDocumentResult;
      } => doc.status === 'profiled' && Boolean(doc.profile_result),
    )
    .map((doc) => doc.profile_result);

  const detectedAreas = [
    ...new Set(profiledResults.flatMap((result) => result.detected_data_areas)),
  ];
  const missingAreaDetailsByArea = new Map<KnownProfilingArea, MissingRecommendedDataAreaDetail>();
  const missingAreaDetailsRaw = profiledResults.flatMap((result) => {
    if (Array.isArray(result.recommendations.missing_recommended_data_areas_details)) {
      return result.recommendations.missing_recommended_data_areas_details;
    }

    return result.recommendations.missing_recommended_data_areas
      .filter((area): area is KnownProfilingArea => area !== 'unknown')
      .map((area) => ({
        data_area: area,
        source: 'goal_rule' as const,
        reason: 'Legacy profile result did not include source-aware missing-area details.',
        confidence: 'low' as const,
      }));
  });

  for (const detail of missingAreaDetailsRaw) {
    const existing = missingAreaDetailsByArea.get(detail.data_area);
    if (!existing) {
      missingAreaDetailsByArea.set(detail.data_area, detail);
      continue;
    }

    missingAreaDetailsByArea.set(detail.data_area, {
      ...existing,
      source:
        existing.source === detail.source
          ? existing.source
          : existing.source === 'combined' || detail.source === 'combined'
            ? 'combined'
            : 'combined',
      confidence: strongerConfidence(existing.confidence, detail.confidence),
      reason:
        existing.reason === detail.reason ? existing.reason : `${existing.reason} ${detail.reason}`,
    });
  }

  const missingAreaDetails = [...missingAreaDetailsByArea.values()];
  const missingAreas = missingAreaDetails.map((detail) => detail.data_area);
  const likelyIgnorableSheets = [
    ...new Set(profiledResults.flatMap((result) => result.recommendations.likely_ignorable_sheets)),
  ];

  const suggestedNextStep =
    missingAreas.length > 0
      ? `Supplement workbook context for: ${missingAreas.join(', ')}. Then continue to next step.`
      : profiledResults.length > 0
        ? 'Workbook profiling complete. Continue to next workflow step.'
        : 'Run workbook profiling to continue.';

  return {
    generated_at: new Date().toISOString(),
    document_count: documents.length,
    profiled_document_count: profiledResults.length,
    total_sheet_count: profiledResults.reduce(
      (sum, result) => sum + result.workbook_summary.sheet_count,
      0,
    ),
    total_row_count: profiledResults.reduce(
      (sum, result) => sum + result.workbook_summary.total_rows,
      0,
    ),
    detected_data_areas: detectedAreas,
    missing_recommended_data_areas: missingAreas,
    missing_recommended_data_areas_details: missingAreaDetails,
    likely_ignorable_sheets: likelyIgnorableSheets,
    suggested_next_step: suggestedNextStep,
  };
}

export function deriveCurrentProfilingStepStatus(
  documents: SessionDocumentProfileRecord[],
): 'in_progress' | 'completed' | 'failed' {
  const hasProfiling = documents.some(
    (doc) => doc.status === 'uploaded' || doc.status === 'profiling',
  );
  if (hasProfiling) {
    return 'in_progress';
  }

  const hasProfiled = documents.some((doc) => doc.status === 'profiled');
  return hasProfiled ? 'completed' : 'failed';
}

export function applyProfilingReviewOverrides(
  documents: SessionDocumentProfileRecord[],
  overrides: ProfilingSheetReviewOverride[],
): SessionDocumentProfileRecord[] {
  if (overrides.length === 0) {
    return documents;
  }

  const overrideBySheet = new Map(
    overrides.map((override) => [`${override.document_id}::${override.sheet_name}`, override]),
  );

  return documents.map((doc) => {
    if (!doc.profile_result) {
      return doc;
    }

    const sheets = doc.profile_result.sheets.map((sheet) => {
      const override = overrideBySheet.get(`${doc.document_id}::${sheet.sheet_name}`);
      if (!override) {
        return sheet;
      }

      const nextArea: ProfilingArea = override.mark_ignore ? 'unknown' : override.final_area;
      const nextConfidence: InterpretationConfidence =
        sheet.final_decision?.confidence ?? confidenceBandFromScore(sheet.confidence ?? 0);

      return {
        ...sheet,
        candidate_business_area: nextArea,
        llm_interpretation: sheet.llm_interpretation
          ? {
              ...sheet.llm_interpretation,
              probable_area: (override.mark_ignore
                ? 'ignore'
                : override.final_area) as WorkbookSheetLlmInterpretation['probable_area'],
              recommended_action: override.mark_ignore
                ? 'ignore'
                : sheet.llm_interpretation.recommended_action,
            }
          : sheet.llm_interpretation,
        final_decision: {
          area: nextArea,
          confidence: nextConfidence,
          source: 'user_override' as const,
          requires_user_review: false,
        },
      };
    });

    const detectedAreas = [
      ...new Set(
        sheets
          .map((sheet) => sheet.final_decision?.area ?? sheet.candidate_business_area)
          .filter((area): area is KnownProfilingArea => area !== 'unknown'),
      ),
    ];

    return {
      ...doc,
      profile_result: {
        ...doc.profile_result,
        sheets,
        detected_data_areas: detectedAreas,
      },
    };
  });
}

export function applyWaivedMissingAreas(
  summary: WorkbookProfilingSessionSummary,
  waivedAreas: KnownProfilingArea[],
): WorkbookProfilingSessionSummary {
  if (waivedAreas.length === 0) {
    return summary;
  }

  const waived = new Set(waivedAreas);
  const missing_recommended_data_areas = summary.missing_recommended_data_areas.filter(
    (area): area is KnownProfilingArea => area !== 'unknown' && !waived.has(area),
  );

  const missing_recommended_data_areas_details =
    summary.missing_recommended_data_areas_details.filter(
      (detail) => !waived.has(detail.data_area),
    );

  const suggested_next_step =
    missing_recommended_data_areas.length > 0
      ? `Supplement workbook context for: ${missing_recommended_data_areas.join(', ')}. Then continue to next step.`
      : 'Workbook profiling review is complete. Continue to the next workflow step.';

  return {
    ...summary,
    missing_recommended_data_areas,
    missing_recommended_data_areas_details,
    suggested_next_step,
  };
}
