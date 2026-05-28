import { z } from 'zod';

export const WorkingMemoryUserContextSchema = z.object({
  timezone: z.string().nullable(),
  communicationStyle: z.string().nullable(),
  currentFocus: z.string().nullable(),
  preferredTaskView: z.string().nullable(),
  notes: z.string().nullable(),
});

export const RecentTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1),
  lastSeenAt: z.string().datetime(),
});

export const WorkingMemoryEntitiesSchema = z.object({
  recentTasks: z.array(RecentTaskSchema).max(10),
  lastDiscussedTaskId: z.string().uuid().nullable(),
  lastProposedCandidateUserId: z.string().uuid().nullable(),
  pendingDecision: z.object({ taskId: z.string().uuid(), userId: z.string().uuid() }).nullable(),
  rejectedCandidates: z
    .array(z.object({ taskId: z.string().uuid(), userId: z.string().uuid() }))
    .max(20),
});

export const WorkingMemorySchema = z.object({
  userContext: WorkingMemoryUserContextSchema,
  entities: WorkingMemoryEntitiesSchema,
});

export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;
export type WorkingMemoryEntities = z.infer<typeof WorkingMemoryEntitiesSchema>;
export type RecentTask = z.infer<typeof RecentTaskSchema>;

export const EMPTY_WORKING_MEMORY: WorkingMemory = {
  userContext: {
    timezone: null,
    communicationStyle: null,
    currentFocus: null,
    preferredTaskView: null,
    notes: null,
  },
  entities: {
    recentTasks: [],
    lastDiscussedTaskId: null,
    lastProposedCandidateUserId: null,
    pendingDecision: null,
    rejectedCandidates: [],
  },
};

export function parseWorkingMemory(raw: string | null | undefined): WorkingMemory {
  if (!raw) return EMPTY_WORKING_MEMORY;
  try {
    const parsed = JSON.parse(raw);
    const result = WorkingMemorySchema.safeParse(parsed);
    return result.success ? result.data : EMPTY_WORKING_MEMORY;
  } catch {
    return EMPTY_WORKING_MEMORY;
  }
}

export function serializeWorkingMemory(wm: WorkingMemory): string {
  return JSON.stringify(wm);
}
