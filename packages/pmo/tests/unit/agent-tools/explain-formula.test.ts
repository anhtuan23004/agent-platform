import { RequestContext } from '@mastra/core/request-context';
import { describe, expect, it } from 'vitest';
import { pmoExplainFormulaTool } from '../../../src/backend/agent-tools/explain-formula.ts';

async function execute(input: Record<string, unknown>) {
  const requestContext = new RequestContext();
  requestContext.set('tenant_id', 'tenant-1');
  requestContext.set('actor', { type: 'user', user_id: 'user-1' });
  const callTool = pmoExplainFormulaTool.execute as NonNullable<
    typeof pmoExplainFormulaTool.execute
  >;
  return callTool(input, { requestContext } as never) as Promise<{
    formulas: Record<string, string>;
    thresholds: {
      overbookWarningAbove: number;
      overbookRedAtOrAbove: number;
      idleRedBelow: number;
      mismatchPctThreshold: number;
    };
    exclusions: string[];
  }>;
}

describe('pmo_explainFormula tool', () => {
  it('returns deterministic formulas and thresholds from rule catalog', async () => {
    const result = await execute({ topic: 'busy_rate', effectiveDate: '2026-06-29' });

    expect(result.formulas.N01).toBe('busyRate = plannedHours / availableHours');
    expect(result.thresholds.overbookWarningAbove).toBe(1.1);
    expect(result.thresholds.overbookRedAtOrAbove).toBe(1.2);
    expect(result.thresholds.idleRedBelow).toBe(0.75);
    expect(result.thresholds.mismatchPctThreshold).toBe(0.2);
    expect(result.exclusions).toContain(
      'Zero-capacity weeks are excluded from member-level busy/effort aggregation.',
    );
  });
});
