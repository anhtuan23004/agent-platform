import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { CanonicalTable } from './canonical-schema.ts';
import type { SheetProfile } from './profile-columns.ts';

const LLM_MAPPING_HINT_PROMPT = `You are a PMO column-mapping assistant.

Goal:
- Suggest the most likely source column for each canonical field.
- Return cautious confidence scores from 0 to 1.

Rules:
- Use only source columns provided in the input.
- Prefer precision over recall.
- If uncertain, use low confidence.
- Do not invent fields or columns.

Return only structured output.`;

const LlmMappingHintsSchema = z.object({
  field_mappings: z.array(
    z.object({
      canonical_field: z.string().min(1),
      source_column: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

type LlmMappingHints = z.infer<typeof LlmMappingHintsSchema>;

export type LlmMappingHintMap = Map<string, number>;

export function llmMappingHintKey(fieldName: string, sourceColumn: string): string {
  return `${fieldName}::${sourceColumn}`;
}

function resolveMappingModel(): string {
  const direct = process.env.PMO_MAPPING_MODEL?.trim();
  if (direct) {
    return direct;
  }

  const fromPlan = process.env.PMO_PLAN_MODEL?.trim();
  if (fromPlan) {
    return fromPlan;
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

function isMappingLlmEnabled(): boolean {
  const raw = process.env.PMO_MAPPING_LLM_ENABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

let mappingHintAgent: Agent | null = null;

function getMappingHintAgent(): Agent {
  if (!mappingHintAgent) {
    mappingHintAgent = new Agent({
      id: 'pmo.mappingHintAgent',
      name: 'PMO Mapping Hint Agent',
      instructions: LLM_MAPPING_HINT_PROMPT,
      model: resolveMappingModel(),
    });
  }

  return mappingHintAgent;
}

function buildMappingHintPayload(input: {
  sheetProfile: SheetProfile;
  table: CanonicalTable;
}): Record<string, unknown> {
  return {
    sheet_name: input.sheetProfile.sheetName,
    header_row: input.sheetProfile.headerRow,
    row_count: input.sheetProfile.rowCount,
    source_columns: input.sheetProfile.columns.slice(0, 60).map((column) => ({
      name: column.columnName,
      inferred_type: column.inferredType,
      sample_values: column.sampleValues.slice(0, 4),
    })),
    canonical_table: {
      id: input.table.id,
      label: input.table.label,
      description: input.table.description,
      fields: input.table.fields.map((field) => ({
        name: field.name,
        label: field.label,
        required: field.required,
        data_type: field.dataType,
        synonyms: field.synonyms.slice(0, 12),
        description: field.description,
      })),
    },
  };
}

function toHintMap(input: {
  llm: LlmMappingHints;
  sheetProfile: SheetProfile;
  table: CanonicalTable;
}): LlmMappingHintMap {
  const validFields = new Set(input.table.fields.map((field) => field.name));
  const validColumns = new Set(input.sheetProfile.columns.map((column) => column.columnName));
  const out: LlmMappingHintMap = new Map();

  for (const mapping of input.llm.field_mappings) {
    const field = mapping.canonical_field.trim();
    const sourceColumn = mapping.source_column.trim();
    if (!validFields.has(field)) continue;
    if (!validColumns.has(sourceColumn)) continue;
    out.set(llmMappingHintKey(field, sourceColumn), clamp01(mapping.confidence));
  }

  return out;
}

export async function maybeInferLlmMappingHints(input: {
  sheetProfile: SheetProfile;
  table: CanonicalTable;
}): Promise<LlmMappingHintMap | null> {
  if (!isMappingLlmEnabled()) {
    return null;
  }

  try {
    const agent = getMappingHintAgent();
    const payload = buildMappingHintPayload(input);

    const result = await agent.generate(JSON.stringify(payload), {
      structuredOutput: { schema: LlmMappingHintsSchema },
      providerOptions: { openai: { reasoningSummary: 'auto' } },
    });

    const parsed = result.object;
    if (!parsed) {
      return null;
    }

    const hints = toHintMap({
      llm: parsed,
      sheetProfile: input.sheetProfile,
      table: input.table,
    });

    return hints.size > 0 ? hints : null;
  } catch (error) {
    console.warn('[pmo/ingestion] mapping hints skipped:', error);
    return null;
  }
}
