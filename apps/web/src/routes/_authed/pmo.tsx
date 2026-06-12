import { createFileRoute } from '@tanstack/react-router';
import { PmoPage } from '@/modules/pmo/pages/pmo-page';

export const Route = createFileRoute('/_authed/pmo')({
  component: PmoPage,
});
