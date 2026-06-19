import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { ChatScreen } from '@/modules/agent/chat-screen';
import { markThreadFresh } from '@/modules/agent/lib/fresh-thread-store';

const SearchSchema = z.object({ thread: z.string().optional() });

export const Route = createFileRoute('/_authed/pmo/agent')({
  validateSearch: SearchSchema,
  // Same mint-before-mount contract as the staffing chat route: own the thread
  // id client-side so the URL, the AUI runtime, and the Mastra row agree from
  // the first send.
  beforeLoad: ({ search }) => {
    if (!search.thread) {
      const id = crypto.randomUUID();
      markThreadFresh(id);
      throw redirect({ to: '/pmo/agent', search: { thread: id }, replace: true });
    }
  },
  component: PmoAgentRoute,
});

function PmoAgentRoute() {
  const { thread } = Route.useSearch();
  return <ChatScreen threadId={thread} chatAgent="pmo" />;
}
