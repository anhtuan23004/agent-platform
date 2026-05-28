import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORKING_MEMORY,
  parseWorkingMemory,
  serializeWorkingMemory,
  WorkingMemorySchema,
} from '../../src/backend/working-memory-schema.ts';

describe('WorkingMemorySchema', () => {
  it('accepts the empty default', () => {
    expect(() => WorkingMemorySchema.parse(EMPTY_WORKING_MEMORY)).not.toThrow();
  });

  it('rejects non-UUID taskId in recentTasks', () => {
    const bad = {
      ...EMPTY_WORKING_MEMORY,
      entities: {
        ...EMPTY_WORKING_MEMORY.entities,
        recentTasks: [{ taskId: 'not-a-uuid', title: 't', lastSeenAt: new Date().toISOString() }],
      },
    };
    expect(() => WorkingMemorySchema.parse(bad)).toThrow(/uuid/i);
  });

  it('parseWorkingMemory returns EMPTY on null/empty/invalid JSON', () => {
    expect(parseWorkingMemory(null)).toEqual(EMPTY_WORKING_MEMORY);
    expect(parseWorkingMemory('')).toEqual(EMPTY_WORKING_MEMORY);
    expect(parseWorkingMemory('not json')).toEqual(EMPTY_WORKING_MEMORY);
    expect(parseWorkingMemory('{"entities": {"recentTasks": [{"taskId": "garbage"}]}}')).toEqual(
      EMPTY_WORKING_MEMORY,
    );
  });

  it('parseWorkingMemory round-trips valid data', () => {
    const wm = {
      ...EMPTY_WORKING_MEMORY,
      userContext: { ...EMPTY_WORKING_MEMORY.userContext, timezone: 'Asia/Ho_Chi_Minh' },
    };
    expect(parseWorkingMemory(serializeWorkingMemory(wm))).toEqual(wm);
  });

  it('serializeWorkingMemory writes deterministic JSON', () => {
    const out = serializeWorkingMemory(EMPTY_WORKING_MEMORY);
    expect(JSON.parse(out)).toEqual(EMPTY_WORKING_MEMORY);
  });
});
