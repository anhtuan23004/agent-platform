import { EmptyState, PageChrome } from '@seta/shared-ui';
import { useNavigate } from '@tanstack/react-router';
import { Box } from 'lucide-react';

export function PmoPage() {
  const navigate = useNavigate();

  return (
    <PageChrome title="Pmo">
      <EmptyState
        icon={<Box className="size-6" />}
        title="No PMO data yet"
        description="Upload a workbook to ingest PMO data, or run insert-demo-fixture-to-tenant.ts to seed demo data. Then open the calculation demo to view each pipeline stage."
        action={{
          label: 'Open calculation demo',
          onClick: () => navigate({ to: '/pmo/demo-calculation' }),
        }}
      />
    </PageChrome>
  );
}
