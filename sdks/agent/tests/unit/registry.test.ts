import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry, RegistryFrozenError, RegistryNotFrozenError } from '../../src/registry';

describe('AgentRegistry', () => {
  beforeEach(() => AgentRegistry.__resetForTests());

  it('starts unfrozen and accepts registrations', () => {
    expect(AgentRegistry.isFrozen()).toBe(false);
    AgentRegistry.registerSpecialist({
      domain: 'work',
      id: 'planner',
      description: 'Manages tasks',
      instructions: () => 'You manage tasks.',
      tools: {},
    });
    expect(AgentRegistry.listSpecialists('work').map((s) => s.id)).toEqual(['planner']);
  });

  it('refuses registrations after freeze', () => {
    AgentRegistry.freeze();
    expect(() =>
      AgentRegistry.registerSpecialist({
        domain: 'work',
        id: 'x',
        description: '',
        instructions: () => '',
        tools: {},
      }),
    ).toThrow(RegistryFrozenError);
  });

  it('refuses reads before freeze', () => {
    AgentRegistry.registerSpecialist({
      domain: 'work',
      id: 'planner',
      description: 'd',
      instructions: () => '',
      tools: {},
    });
    expect(() => AgentRegistry.snapshot()).toThrow(RegistryNotFrozenError);
  });

  it('registers and resolves workflow snapshot decorators by workflow id', () => {
    AgentRegistry.registerWorkflowSnapshotDecorator({
      id: 'pmo.dynamic-graph',
      workflowIds: ['pmo.ingestData.v2'],
      decorate: async (args) => args.snapshot,
    });

    const decorators = AgentRegistry.listWorkflowSnapshotDecorators('pmo.ingestData.v2');
    expect(decorators).toHaveLength(1);
    expect(decorators[0]?.id).toBe('pmo.dynamic-graph');
  });
});
