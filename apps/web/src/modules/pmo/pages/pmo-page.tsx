import { EmptyState, PageChrome } from '@seta/shared-ui';
import { Box } from 'lucide-react';

export function PmoPage() {
  return (
    <PageChrome title="Pmo">
      <EmptyState
        icon={<Box className="size-6" />}
        title="No Pmo data yet"
        description="This module is scaffolded. Add a domain function and a list screen to fill this page."
      />
    </PageChrome>
  );
}
