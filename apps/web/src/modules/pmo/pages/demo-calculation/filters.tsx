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
import { hasCustomDateRange, type SourceUploadOption } from '../demo-calculation-page.logic.ts';

interface DemoCalculationFiltersProps {
  members: string[];
  projects: string[];
  uploadOptions: SourceUploadOption[];
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
    thresholds?.idleYellowThreshold !== undefined ||
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
    thresholds.idleYellowThreshold,
    thresholds.mismatchPctThreshold,
    analyticsSettings?.from,
    analyticsSettings?.to,
    analyticsSettings?.configEffectiveDate,
  ].join(':');

  const hasFilter = Boolean(
    selectedUploadId ||
      memberFilter ||
      projectFilter ||
      analyticsSettings?.from ||
      analyticsSettings?.to,
  );
  const setUploadFilter = (upload: SourceUploadOption | null) => {
    const uploadPeriodStart = upload?.reportingPeriodStart ?? undefined;
    const uploadPeriodEnd = upload?.reportingPeriodEnd ?? undefined;
    const shouldPrefillRange =
      uploadPeriodStart && uploadPeriodEnd && !hasCustomDateRange(analyticsSettings);
    onAnalyticsSettingsChange(
      compactSettings({
        ...(analyticsSettings ?? {}),
        ingestionSessionId: upload?.id,
        ...(shouldPrefillRange
          ? {
              from: uploadPeriodStart,
              to: uploadPeriodEnd,
            }
          : {}),
      }),
    );
  };
  const clearDataFilters = () => {
    onMemberFilterChange(null);
    onProjectFilterChange(null);
    onAnalyticsSettingsChange(
      compactSettings({
        ...(analyticsSettings ?? {}),
        ingestionSessionId: undefined,
      }),
    );
  };
  const publishedUploadOptions = uploadOptions.filter((upload) => upload.group === 'published');
  const myUploadOptions = uploadOptions.filter((upload) => upload.group === 'mine');

  return (
    <div className="space-y-3">
      <CalculationSettingsForm
        key={calculationSettingsKey}
        reportingWindow={reportingWindow}
        thresholdConfig={thresholdConfig}
        thresholds={thresholds}
        analyticsSettings={analyticsSettings}
        onAnalyticsSettingsChange={onAnalyticsSettingsChange}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={uploadOpen} onOpenChange={setUploadOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm">
                <Filter className="size-4" />
                Source upload
                <ChevronDown className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[360px] p-0">
              <Command>
                <CommandInput placeholder="Search source upload…" />
                <CommandList>
                  <CommandEmpty>No uploads found.</CommandEmpty>
                  <CommandGroup heading="Published data">
                    <CommandItem
                      onSelect={() => {
                        setUploadFilter(null);
                        setUploadOpen(false);
                      }}
                    >
                      Current published data
                    </CommandItem>
                    {publishedUploadOptions.map((upload) => (
                      <CommandItem
                        key={upload.id}
                        disabled={upload.disabled}
                        onSelect={() => {
                          if (upload.disabled) return;
                          setUploadFilter(upload);
                          setUploadOpen(false);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{upload.label}</div>
                          <div className="text-caption text-ink-muted">
                            {upload.uploadedAtLabel} · {upload.statusLabel}
                          </div>
                          <div className="text-caption text-ink-subtle">
                            {upload.reportingPeriodLabel}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {myUploadOptions.length > 0 ? (
                    <CommandGroup heading="Your uploads">
                      {myUploadOptions.map((upload) => (
                        <CommandItem
                          key={upload.id}
                          disabled={upload.disabled}
                          onSelect={() => {
                            if (upload.disabled) return;
                            setUploadFilter(upload);
                            setUploadOpen(false);
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{upload.label}</div>
                            <div className="text-caption text-ink-muted">
                              {upload.uploadedAtLabel} · {upload.statusLabel}
                            </div>
                            <div className="text-caption text-ink-subtle">
                              {upload.reportingPeriodLabel}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
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
            <Badge variant="secondary">Source: {selectedUploadLabel ?? selectedUploadId}</Badge>
          ) : null}
          {memberFilter ? <Badge variant="secondary">Member: {memberFilter}</Badge> : null}
          {projectFilter ? <Badge variant="secondary">Project: {projectFilter}</Badge> : null}

          {hasFilter ? (
            <Button variant="ghost" size="sm" onClick={clearDataFilters}>
              <X className="size-4" />
              Clear filters
            </Button>
          ) : (
            <span className="text-body-sm text-ink-subtle">
              All published sources, members & projects
            </span>
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
  const [from, setFrom] = useState(analyticsSettings?.from ?? reportingWindow.start);
  const [to, setTo] = useState(analyticsSettings?.to ?? reportingWindow.end);
  const [overbookY, setOverbookY] = useState(pctInput(thresholds.overbookThreshold));
  const [overbookR, setOverbookR] = useState(pctInput(thresholds.overbookRedThreshold));
  const [idleY, setIdleY] = useState(pctInput(thresholds.idleYellowThreshold));
  const [idleR, setIdleR] = useState(pctInput(thresholds.idleThreshold));
  const [mismatch, setMismatch] = useState(pctInput(thresholds.mismatchPctThreshold));

  const hasCalculationSettings = Boolean(
    analyticsSettings?.from ||
      analyticsSettings?.to ||
      analyticsSettings?.configEffectiveDate ||
      analyticsSettings?.thresholds?.overbookThreshold !== undefined ||
      analyticsSettings?.thresholds?.overbookRedThreshold !== undefined ||
      analyticsSettings?.thresholds?.idleThreshold !== undefined ||
      analyticsSettings?.thresholds?.idleYellowThreshold !== undefined ||
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
          idleYellowThreshold: parsePctInput(idleY),
          idleThreshold: parsePctInput(idleR),
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
    setIdleY(pctInput(thresholds.idleYellowThreshold));
    setIdleR(pctInput(thresholds.idleThreshold));
    setMismatch(pctInput(thresholds.mismatchPctThreshold));
    onAnalyticsSettingsChange(
      compactSettings({ ingestionSessionId: analyticsSettings?.ingestionSessionId }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-body-sm font-semibold text-ink">Calculation settings</div>
          <div className="max-w-full text-caption text-ink-muted">
            Adjust the date range and thresholds used for this calculation.
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

      <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(220px,0.8fr)_minmax(360px,1.4fr)]">
        <div className="space-y-2">
          <div className="text-caption font-medium text-ink-muted">Date range</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pmo-week-from" className="text-caption text-ink-muted">
                From
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
                To
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
          <div className="text-caption font-medium text-ink-muted">Thresholds</div>
          <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(120px,0.7fr)]">
            <div className="space-y-1 rounded-md border border-hairline bg-surface-1 px-2 py-2">
              <div className="text-caption font-medium text-ink">Overbook</div>
              <div className="grid grid-cols-2 gap-2">
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
              </div>
            </div>
            <div className="space-y-1 rounded-md border border-hairline bg-surface-1 px-2 py-2">
              <div className="text-caption font-medium text-ink">Idle</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="pmo-idle-y" className="text-caption text-ink-muted">
                    Warning %
                  </Label>
                  <Input
                    id="pmo-idle-y"
                    type="number"
                    size="sm"
                    min="0"
                    step="1"
                    value={idleY}
                    onChange={(event) => setIdleY(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pmo-idle-r" className="text-caption text-ink-muted">
                    Critical %
                  </Label>
                  <Input
                    id="pmo-idle-r"
                    type="number"
                    size="sm"
                    min="0"
                    step="1"
                    value={idleR}
                    onChange={(event) => setIdleR(event.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1 rounded-md border border-hairline bg-surface-1 px-2 py-2">
              <div className="text-caption font-medium text-ink">Mismatch</div>
              <Label htmlFor="pmo-mismatch" className="text-caption text-ink-muted">
                Threshold %
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
