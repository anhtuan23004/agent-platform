import { Badge } from '@seta/shared-ui';
import { issueMeta } from './finding-metadata.ts';

export function IssueBadge({ issueType, ragColor }: { issueType: string; ragColor: string }) {
  const meta = issueMeta(issueType);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant={
          meta.tone === 'danger'
            ? 'destructive'
            : meta.tone === 'warning'
              ? 'warning'
              : meta.tone === 'success'
                ? 'success'
                : 'secondary'
        }
        className="gap-1"
      >
        <meta.icon className="size-3" />
        {meta.label}
      </Badge>
      <Badge
        variant={
          ragColor === 'red'
            ? 'destructive'
            : ragColor === 'yellow'
              ? 'warning'
              : ragColor === 'green'
                ? 'success'
                : 'secondary'
        }
      >
        {ragColor}
      </Badge>
    </div>
  );
}
