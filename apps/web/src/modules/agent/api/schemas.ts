import { z } from 'zod';

export const ChatAgentMode = z.enum(['staffing', 'pmo']);
export type ChatAgentMode = z.infer<typeof ChatAgentMode>;

export const ThreadSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: z.string(),
  chatAgent: ChatAgentMode.optional(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

export const ThreadsResponse = z.object({ threads: z.array(ThreadSummary) });
