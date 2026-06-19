export const AGENT_COPY = {
  threadsTitle: 'Chat',
  newThread: 'New chat',
  searchThreads: 'Search chats…',
  emptyThreads: {
    title: 'Ask me anything',
    body: 'I can answer questions and take action on your behalf. You’ll review every change before it goes through.',
  },
  emptySuggestions: ['Summarize this plan', 'Who’s assigned to what?', 'What’s blocked?'] as const,
  composerPlaceholder: 'Ask anything…',
  composerHint: 'Every change waits for your OK',
  modelUnavailable: 'No model is configured yet. Ask your admin to set this up.',
  rateLimited: (s: number) => `You’re going a bit fast — try again in ${s}s.`,
  hitlExpired: 'This request timed out. Ask again to continue.',
  permissionRevoked: 'You don’t have permission for this anymore, so nothing changed.',
} as const;

/** Per-agent branding + empty-state copy for Agent Studio chat modes. */
export const CHAT_AGENT_COPY = {
  staffing: {
    label: 'Staffing Agent',
    emptyTitle: 'Ask me anything',
    emptyBody: AGENT_COPY.emptyThreads.body,
    suggestions: ['Summarize this plan', 'Who’s assigned to what?', 'What’s blocked?'] as const,
    placeholder: 'Ask anything…',
  },
  pmo: {
    label: 'PMO Agent',
    emptyTitle: 'Ask about utilization or ingest data',
    emptyBody:
      'Upload a PMO workbook to ingest and publish, or ask about overbooked/idle members and logged-vs-planned mismatch from published data.',
    suggestions: [
      'Ingest this workbook and generate a utilization report',
      'Who is overbooked right now?',
      'Show idle members',
    ] as const,
    placeholder: 'Upload a workbook to ingest, or ask about utilization…',
  },
} as const;

export type ChatAgentCopyKey = keyof typeof CHAT_AGENT_COPY;
