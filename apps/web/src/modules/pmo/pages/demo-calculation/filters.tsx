import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@seta/shared-ui';
import { ChevronDown, Filter, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import type { DemoAnalyticsSettings, DemoThresholds } from '../../api/demo-analytics.ts';

interface DemoCalculationFiltersProps {
  members: string[];
  projects: string[];
  uploadOptions: Array<{ id: string; label: string; statusLabel: string }>;
  memberFilter: string | null;
  projectFilter: string | null;
  selectedUploadId: string | null;
  selectedUploadLabel: string | null;
  onMemberFilterChange: (id: string | null) => void;
  onProjectFilterChange: (id: string | null) => void;
  getProjectLabel: (id: string) => string;
  reportingWindow: { start: string; end: string };
  thresholdConfig: {
    configId: string | null;
    ruleName: string | null;
    effectiveDate: string | null;
  };
  thresholds: DemoThresholds;
  analyticsSettings: DemoAnalyticsSettings | undefined;
  onAnalyticsSettingsChange: (settings: DemoAnalyticsSettings | undefined) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

interface CalculationSettingsFormProps {
  reportingWindow: { start: string; end: string };
  thresholdConfig: {
    configId: string | null;
    ruleName: string | null;
    effectiveDate: string | null;
  };
  thresholds: DemoThresholds;
  analyticsSettings: DemoAnalyticsSettings | undefined;
  onAnalyticsSettingsChange: (settings: DemoAnalyticsSettings | undefined) => void;
}

function compactSettings(settings: DemoAnalyticsSettings): DemoAnalyticsSettings | undefined {
  const thresholds = settings.thresholds;
  const hasThresholds =
    thresholds?.overbookThreshold !== undefined ||
    thresholds?.overbookRedThreshold !== undefined ||
    thresholds?.idleThreshold !== undefined ||
    thresholds?.mismatchPctThreshold !== undefined;
  if (
    !settings.from &&
    !settings.to &&
    !settings.configEffectiveDate &&
    !settings.ingestionSessionId &&
    !hasThresholds
  ) {
    return undefined;
  }
  return {
    ...(settings.from ? { from: settings.from } : {}),
    ...(settings.to ? { to: settings.to } : {}),
    ...(settings.configEffectiveDate ? { configEffectiveDate: settings.configEffectiveDate } : {}),
    ...(settings.ingestionSessionId ? { ingestionSessionId: settings.ingestionSessionId } : {}),
    ...(hasThresholds ? { thresholds } : {}),
  };
}

function pctInput(value: number): string {
  return String(Math.round(value * 1000) / 10);
}

function parsePctInput(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : undefined;
}

export function DemoCalculationFilters({
  members,
  projects,
  uploadOptions,
  memberFilter,
  projectFilter,
  selectedUploadId,
  selectedUploadLabel,
  onMemberFilterChange,
  onProjectFilterChange,
  getProjectLabel,
  reportingWindow,
  thresholdConfig,
  thresholds,
  analyticsSettings,
  onAnalyticsSettingsChange,
  onRefresh,
  isRefreshing,
}: DemoCalculationFiltersProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const calculationSettingsKey = [
    reportingWindow.start,
    reportingWindow.end,
    thresholdConfig.effectiveDate,
    thresholds.overbookThreshold,
    thresholds.overbookRedThreshold,
    thresholds.idleThreshold,
    thresholds.mismatchPctThreshold,
  ].join(':');

  const hasFilter = Boolean(selectedUploadId || memberFilter || projectFilter);
  const setUploadFilter = (id: string | null) => {
    onAnalyticsSettingsChange(
      compactSettings({
        ...(analyticsSettings ?? {}),
        ingestionSessionId: id ?? undefined,
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={uploadOpen} onOpenChange={setUploadOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm">
                <Filter className="size-4" />
                Upload
                <ChevronDown className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search upload…" />
                <CommandList>
                  <CommandEmpty>No uploads found.</CommandEmpty>
                  <CommandGroup heading="Uploads">
                    <CommandItem
                      onSelect={() => {
                        setUploadFilter(null);
                        setUploadOpen(false);
                      }}
                    >
                      All published data
                    </CommandItem>
                    {uploadOptions.map((upload) => (
                      <CommandItem
                        key={upload.id}
                        onSelect={() => {
                          setUploadFilter(upload.id);
                          setUploadOpen(false);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{upload.label}</div>
                          <div className="text-caption text-ink-muted">{upload.statusLabel}</div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

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

          {selectedUploadId ? (
            <Badge variant="secondary">Upload: {selectedUploadLabel ?? selectedUploadId}</Badge>
          ) : null}
          {memberFilter ? <Badge variant="secondary">Member: {memberFilter}</Badge> : null}
          {projectFilter ? <Badge variant="secondary">Project: {projectFilter}</Badge> : null}

          {hasFilter ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onMemberFilterChange(null);
                onProjectFilterChange(null);
                setUploadFilter(null);
              }}
            >
              <X className="size-4" />
              Clear filters
            </Button>
          ) : (
            <span className="text-body-sm text-ink-subtle">All uploads, members & projects</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-caption text-ink-subtle sm:inline">
            Reload after publish
          </span>
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

      <CalculationSettingsForm
        key={calculationSettingsKey}
        reportingWindow={reportingWindow}
        thresholdConfig={thresholdConfig}
        thresholds={thresholds}
        analyticsSettings={analyticsSettings}
        onAnalyticsSettingsChange={onAnalyticsSettingsChange}
      />
    </div>
  );
}

function CalculationSettingsForm({
  reportingWindow,
  thresholdConfig,
  thresholds,
  analyticsSettings,
  onAnalyticsSettingsChange,
}: CalculationSettingsFormProps) {
  const defaultRuleDate =
    analyticsSettings?.configEffectiveDate ??
    thresholdConfig.effectiveDate ??
    reportingWindow.start;
  const [configEffectiveDate, setConfigEffectiveDate] = useState(defaultRuleDate);
  const [from, setFrom] = useState(reportingWindow.start);
  const [to, setTo] = useState(reportingWindow.end);
  const [overbookY, setOverbookY] = useState(pctInput(thresholds.overbookThreshold));
  const [overbookR, setOverbookR] = useState(pctInput(thresholds.overbookRedThreshold));
  const [idle, setIdle] = useState(pctInput(thresholds.idleThreshold));
  const [mismatch, setMismatch] = useState(pctInput(thresholds.mismatchPctThreshold));

  const hasCalculationSettings = Boolean(
    analyticsSettings?.from ||
      analyticsSettings?.to ||
      analyticsSettings?.configEffectiveDate ||
      analyticsSettings?.thresholds?.overbookThreshold !== undefined ||
      analyticsSettings?.thresholds?.overbookRedThreshold !== undefined ||
      analyticsSettings?.thresholds?.idleThreshold !== undefined ||
      analyticsSettings?.thresholds?.mismatchPctThreshold !== undefined,
  );
  const isRuleDateAfterWindowStart = Boolean(
    configEffectiveDate && from && configEffectiveDate > from,
  );

  const applyCalculationSettings = () => {
    onAnalyticsSettingsChange(
      compactSettings({
        ...(analyticsSettings ?? {}),
        from: from || undefined,
        to: to || undefined,
        configEffectiveDate: configEffectiveDate || undefined,
        thresholds: {
          overbookThreshold: parsePctInput(overbookY),
          overbookRedThreshold: parsePctInput(overbookR),
          idleThreshold: parsePctInput(idle),
          mismatchPctThreshold: parsePctInput(mismatch),
        },
      }),
    );
  };

  const resetCalculationSettings = () => {
    setConfigEffectiveDate(thresholdConfig.effectiveDate ?? reportingWindow.start);
    setFrom(reportingWindow.start);
    setTo(reportingWindow.end);
    setOverbookY(pctInput(thresholds.overbookThreshold));
    setOverbookR(pctInput(thresholds.overbookRedThreshold));
    setIdle(pctInput(thresholds.idleThreshold));
    setMismatch(pctInput(thresholds.mismatchPctThreshold));
    onAnalyticsSettingsChange(
      compactSettings({ ingestionSessionId: analyticsSettings?.ingestionSessionId }),
    );
  };

  return (
    <div className="space-y-3 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-body-sm font-semibold text-ink">Calculation settings</div>
          <div className="max-w-full text-caption text-ink-muted">
            {thresholdConfig.ruleName ?? 'Threshold config'}
            {thresholdConfig.effectiveDate
              ? ` · Active from ${thresholdConfig.effectiveDate}`
              : ' · No active config'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isRuleDateAfterWindowStart}
            onClick={applyCalculationSettings}
          >
            Apply
          </Button>
          {hasCalculationSettings ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetCalculationSettings}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.8fr)_minmax(280px,1fr)_minmax(360px,1.4fr)]">
        <div className="space-y-2">
          <div className="text-caption font-medium text-ink-muted">Rule timing</div>
          <div className="space-y-1">
            <Label htmlFor="pmo-config-effective-date" className="text-caption text-ink-muted">
              Rule date
            </Label>
            <Input
              id="pmo-config-effective-date"
              type="date"
              size="sm"
              value={configEffectiveDate}
              max={from || undefined}
              onChange={(event) => setConfigEffectiveDate(event.target.value)}
            />
            {isRuleDateAfterWindowStart ? (
              <div className="text-[11px] leading-tight text-danger">
                Rule date must be on or before Week from.
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-caption font-medium text-ink-muted">Reporting window</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pmo-week-from" className="text-caption text-ink-muted">
                Week from
              </Label>
              <Input
                id="pmo-week-from"
                type="date"
                size="sm"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pmo-week-to" className="text-caption text-ink-muted">
                Week to
              </Label>
              <Input
                id="pmo-week-to"
                type="date"
                size="sm"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-caption font-medium text-ink-muted">Thresholds</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="pmo-overbook-y" className="text-caption text-ink-muted">
                Warning %
              </Label>
              <Input
                id="pmo-overbook-y"
                type="number"
                size="sm"
                min="0"
                step="1"
                value={overbookY}
                onChange={(event) => setOverbookY(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pmo-overbook-r" className="text-caption text-ink-muted">
                Critical %
              </Label>
              <Input
                id="pmo-overbook-r"
                type="number"
                size="sm"
                min="0"
                step="1"
                value={overbookR}
                onChange={(event) => setOverbookR(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pmo-idle" className="text-caption text-ink-muted">
                Idle %
              </Label>
              <Input
                id="pmo-idle"
                type="number"
                size="sm"
                min="0"
                step="1"
                value={idle}
                onChange={(event) => setIdle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pmo-mismatch" className="text-caption text-ink-muted">
                Mismatch %
              </Label>
              <Input
                id="pmo-mismatch"
                type="number"
                size="sm"
                min="0"
                step="1"
                value={mismatch}
                onChange={(event) => setMismatch(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
