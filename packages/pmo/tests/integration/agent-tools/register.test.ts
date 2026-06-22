import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('pmo register', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports PMO analytics agent tools and registers workflow metadata', async () => {
    const { AgentRegistry } = await import('@seta/agent-sdk');
    AgentRegistry.__resetForTests();

    const { pmoAgentTools } = await import('../../../src/backend/agent-tools/register.ts');

    expect(pmoAgentTools.map((tool) => (tool as { id: string }).id).sort()).toEqual(
      [
        'pmo_computeMemberWeekFacts',
        'pmo_detectMismatch',
        'pmo_detectOverbookIdle',
        'pmo_explainFormula',
        'pmo_generateReport',
        'pmo_recommendRebalance',
      ].sort(),
    );
    expect(AgentRegistry.listWorkflows('work').map((workflow) => workflow.id)).toContain(
      'ingestDataV2',
    );
  });
});
