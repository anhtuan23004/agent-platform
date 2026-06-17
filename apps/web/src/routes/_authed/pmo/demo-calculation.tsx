import { createFileRoute } from '@tanstack/react-router';
import { DemoCalculationPage } from '@/modules/pmo/pages/demo-calculation-page';

export const Route = createFileRoute('/_authed/pmo/demo-calculation')({
  component: DemoCalculationPage,
});
