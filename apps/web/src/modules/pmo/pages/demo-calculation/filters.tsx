import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@seta/shared-ui';
import { ChevronDown, Filter, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

interface DemoCalculationFiltersProps {
  members: string[];
  projects: string[];
  memberFilter: string | null;
  projectFilter: string | null;
  onMemberFilterChange: (id: string | null) => void;
  onProjectFilterChange: (id: string | null) => void;
  getProjectLabel: (id: string) => string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function DemoCalculationFilters({
  members,
  projects,
  memberFilter,
  projectFilter,
  onMemberFilterChange,
  onProjectFilterChange,
  getProjectLabel,
  onRefresh,
  isRefreshing,
}: DemoCalculationFiltersProps) {
  const [memberOpen, setMemberOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);

  const hasFilter = Boolean(memberFilter || projectFilter);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={memberOpen} onOpenChange={setMemberOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              <Filter className="size-4" />
              Member
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0">
            <Command>
              <CommandInput placeholder="Search member…" />
              <CommandList>
                <CommandEmpty>No members found.</CommandEmpty>
                <CommandGroup heading="Members">
                  {members.map((id) => (
                    <CommandItem
                      key={id}
                      onSelect={() => {
                        onMemberFilterChange(id);
                        setMemberOpen(false);
                      }}
                    >
                      {id}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={projectOpen} onOpenChange={setProjectOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              <Filter className="size-4" />
              Project
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0">
            <Command>
              <CommandInput placeholder="Search project…" />
              <CommandList>
                <CommandEmpty>No projects found.</CommandEmpty>
                <CommandGroup heading="Projects">
                  {projects.map((id) => (
                    <CommandItem
                      key={id}
                      onSelect={() => {
                        onProjectFilterChange(id);
                        setProjectOpen(false);
                      }}
                    >
                      {getProjectLabel(id)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {memberFilter ? <Badge variant="secondary">Member: {memberFilter}</Badge> : null}
        {projectFilter ? <Badge variant="secondary">Project: {projectFilter}</Badge> : null}

        {hasFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onMemberFilterChange(null);
              onProjectFilterChange(null);
            }}
          >
            <X className="size-4" />
            Clear filters
          </Button>
        ) : (
          <span className="text-body-sm text-ink-subtle">All members & projects</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-caption text-ink-subtle sm:inline">Reload after publish</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Reload
        </Button>
      </div>
    </div>
  );
}
