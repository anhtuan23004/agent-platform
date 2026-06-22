import { createHash } from 'node:crypto';
import type { RebalanceRecommendationGroup } from '../recommendations/contracts.ts';
import type { GeneratePmoReportOutput } from '../report-output.ts';
import type { PmoReportRenderModel, RenderedReportHtml } from './contracts.ts';

type ReportFinding = GeneratePmoReportOutput['findings'][number];

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pct(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value * 1000) / 10}%`;
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function renderReportHtml(model: PmoReportRenderModel): RenderedReportHtml {
  validateRenderModel(model);
  const memberMap = new Map(model.report.members.map((member) => [member.memberId, member]));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PMO Workload &amp; Timesheet Report</title>
<style>${CSS}</style>
</head>
<body>
<header class="report-header">
  <div><p class="eyebrow">PMO WORKLOAD ANALYTICS</p><h1>Workload &amp; Timesheet Report</h1></div>
  <div class="header-meta">
    <strong>${escapeHtml(model.tenantName)}</strong>
    <span>${escapeHtml(model.report.dateRange.from)} — ${escapeHtml(model.report.dateRange.to)}</span>
    <span>Generated ${escapeHtml(model.generatedAt)}</span>
  </div>
</header>
<main>
  <section class="provenance" aria-label="Report provenance">
    <div><span>Source</span><strong>${escapeHtml(humanize(model.sourceMode))}</strong></div>
    <div><span>Rule</span><strong>${escapeHtml(model.rule.ruleSetId)} · ${escapeHtml(model.rule.version)}</strong></div>
    <div><span>Facts</span><strong>${escapeHtml(model.report.sourceVersion.factsVersion.slice(0, 12))}</strong></div>
    <div><span>Run</span><strong>${escapeHtml(model.reportRunId)}</strong></div>
  </section>
  ${renderSummary(model.report)}
  ${renderSeveritySection('red', model.report, memberMap)}
  ${renderSeveritySection('yellow', model.report, memberMap)}
  ${renderMethodology()}
</main>
<footer>PMO report · Rule ${escapeHtml(model.rule.version)} · Private</footer>
</body>
</html>`;
  const bytes = Buffer.from(html, 'utf8');
  return {
    html,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

function validateRenderModel(model: PmoReportRenderModel): void {
  if (!model.reportRunId || !model.tenantName) throw new Error('invalid_report_render_identity');
  const generatedAt = new Date(model.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('invalid_report_render_generated_at');
}

function renderSummary(report: GeneratePmoReportOutput): string {
  const cards = [
    ['Members', report.summary.memberCount],
    ['Red', report.findings.filter((finding) => finding.ragColor === 'red').length],
    ['Yellow', report.findings.filter((finding) => finding.ragColor === 'yellow').length],
    [
      'Mismatch',
      report.findings.filter((finding) => finding.issueType.startsWith('mismatch_')).length,
    ],
    ['Excluded weeks', report.summary.excludedWeekCount],
  ];
  return `<section aria-labelledby="summary-title"><h2 id="summary-title">Company summary</h2><div class="summary-grid">${cards
    .map(
      ([label, value]) =>
        `<div class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('')}</div></section>`;
}

function renderSeveritySection(
  severity: 'red' | 'yellow',
  report: GeneratePmoReportOutput,
  memberMap: Map<string, GeneratePmoReportOutput['members'][number]>,
): string {
  const findings = report.findings.filter((finding) => finding.ragColor === severity);
  const overbook = findings.filter((finding) => finding.issueType === 'overbook');
  const idle = findings.filter((finding) => finding.issueType === 'idle');
  const mismatch = findings.filter((finding) => finding.issueType.startsWith('mismatch_'));
  return `<section class="severity-section severity-${severity}" aria-labelledby="${severity}-title">
  <div class="section-title"><span class="severity-label">${severity.toUpperCase()}</span><h2 id="${severity}-title">${humanize(severity)} severity</h2><span>${findings.length} finding${findings.length === 1 ? '' : 's'}</span></div>
  ${renderFindingGroup('Overbook', overbook, report, memberMap)}
  ${renderFindingGroup('Idle', idle, report, memberMap)}
  ${renderFindingGroup('Mismatch', mismatch, report, memberMap)}
</section>`;
}

function renderFindingGroup(
  title: 'Overbook' | 'Idle' | 'Mismatch',
  findings: ReportFinding[],
  report: GeneratePmoReportOutput,
  memberMap: Map<string, GeneratePmoReportOutput['members'][number]>,
): string {
  if (findings.length === 0) {
    return `<section class="finding-group"><h3>${title}</h3><p class="empty-state">No findings</p></section>`;
  }
  return `<section class="finding-group"><h3>${title}</h3>${findings
    .map((finding) => renderFinding(finding, report, memberMap))
    .join('')}</section>`;
}

function renderFinding(
  finding: ReportFinding,
  report: GeneratePmoReportOutput,
  memberMap: Map<string, GeneratePmoReportOutput['members'][number]>,
): string {
  const member = memberMap.get(finding.memberId);
  const displayName = member?.fullName || finding.memberId;
  const context = [member?.roleTitle, member?.department].filter(Boolean).join(' · ');
  const groups = report.recommendations.filter(
    (group) => group.sourceMemberId === finding.memberId,
  );
  return `<article class="finding-card finding-${finding.ragColor}">
  <div class="finding-heading">
    <div><span class="severity-label">${escapeHtml(finding.ragColor.toUpperCase())}</span><h4>${escapeHtml(displayName)}</h4><p>${escapeHtml(context || finding.memberId)}</p></div>
    <div class="primary-metric"><span>Busy rate</span><strong>${pct(finding.busyRate)}</strong></div>
  </div>
  <p class="finding-detail">${escapeHtml(finding.detail)}</p>
  ${renderFindingExplanation(finding)}
  ${renderIssueWeeks(finding)}
  ${renderMetrics(finding)}
  ${renderContextNotes(finding)}
  ${renderSuggestedActions(finding)}
  ${finding.issueType === 'overbook' ? renderRecommendations(groups, memberMap, report.dateRange) : ''}
</article>`;
}

function renderFindingExplanation(finding: ReportFinding): string {
  if (!finding.explanation) return '';
  const tradeoffs = finding.explanation.riskTradeoffs.length
    ? `<ul>${finding.explanation.riskTradeoffs
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul>`
    : '';
  return `<div class="llm-explanation"><strong>Explanation of deterministic finding</strong><p>${escapeHtml(finding.explanation.summary)}</p>${tradeoffs}</div>`;
}

function renderIssueWeeks(finding: ReportFinding): string {
  const weeks = finding.issueWeeks ?? [];
  if (weeks.length === 0) return '';
  return `<div class="issue-weeks"><strong>Affected weeks</strong><table><thead><tr><th>Week</th><th>Dates</th><th>Planned</th><th>Logged</th><th>Available</th><th>Busy</th><th>EC</th></tr></thead><tbody>${weeks
    .map((week) => {
      const dates =
        week.weekStart && week.weekEnd
          ? `${escapeHtml(week.weekStart)} to ${escapeHtml(week.weekEnd)}`
          : 'Unavailable';
      return `<tr><td>${escapeHtml(week.weekId)}</td><td>${dates}</td><td>${number(week.plannedHours)}h</td><td>${number(week.loggedHours)}h</td><td>${number(week.availableHours)}h</td><td>${pct(week.busyRate)}</td><td>${pct(week.effortConsumption)}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

function renderMetrics(finding: ReportFinding): string {
  const labels: Array<[keyof ReportFinding['metricEvidence'], string]> = [
    ['N01', 'Busy rate'],
    ['N02', 'Utilization'],
    ['N03', 'Billable rate'],
    ['N04', 'Bench rate'],
    ['N05', 'Overtime ratio'],
    ['N06', 'Effort consumption'],
    ['N12', 'Training compliance'],
  ];
  return `<table class="metrics-table"><thead><tr><th>Metric</th><th>Definition</th><th>Value</th></tr></thead><tbody>${labels
    .map(
      ([id, label]) =>
        `<tr><td>${id}</td><td>${escapeHtml(label)}</td><td>${pct(finding.metricEvidence[id])}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function renderContextNotes(finding: ReportFinding): string {
  const items = [
    ...finding.excludedWeeks.map((item) => `${item.weekId}: excluded (${humanize(item.reason)})`),
    ...finding.annotations.map((item) => `${item.weekId}: ${humanize(item.reason)}`),
  ];
  return items.length === 0
    ? ''
    : `<div class="context-notes"><strong>Context</strong><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
}

function renderSuggestedActions(finding: ReportFinding): string {
  const actions = finding.suggestedActions;
  if (!actions || actions.length === 0) {
    return `<div class="suggested-action"><strong>Suggested action</strong><span>${escapeHtml(humanize(finding.suggestedActionCode))}</span>${finding.reviewRequired ? '<em>Review required</em>' : ''}</div>`;
  }
  const items = actions.map(
    (action) =>
      `<li${action.primary ? ' class="action-primary"' : ''}><span class="action-code">${escapeHtml(action.actionCode)}</span> ${escapeHtml(action.templateText)}</li>`,
  );
  return `<div class="suggested-actions"><strong>Suggested actions</strong>${finding.reviewRequired ? '<em>Review required</em>' : ''}<ul>${items.join('')}</ul></div>`;
}

function renderRecommendations(
  groups: RebalanceRecommendationGroup[],
  memberMap: Map<string, GeneratePmoReportOutput['members'][number]>,
  dateRange: GeneratePmoReportOutput['dateRange'],
): string {
  const planningStart = groups[0]?.planningPeriod.from ?? nextIsoDate(dateRange.to);
  const planningNote = `Evidence window: ${dateRange.from} to ${dateRange.to}. Recommendations are forward-looking actions from ${planningStart}; confirm future RA demand or select a planning horizon before applying.`;
  const candidateGroups = groups.filter((group) => group.recommendations.length > 0);
  const noResultGroups = groups.filter((group) => group.recommendations.length === 0);
  if (groups.length === 0) {
    return '<div class="recommendation-block"><h5>Rebalance recommendations</h5><p class="empty-state">No candidate-backed rebalance recommendation for this finding.</p></div>';
  }
  const noResultNote =
    noResultGroups.length > 0
      ? `<p class="recommendation-note">No candidate-backed rebalance was produced for ${noResultGroups.length} opportunity${noResultGroups.length === 1 ? '' : 'ies'}. Missing or insufficient candidate evidence: ${escapeHtml([...new Set(noResultGroups.flatMap((group) => group.noResultReasons))].map(humanize).join(', ') || 'No candidate passed hard filters')}.</p>`
      : '';
  if (candidateGroups.length === 0) {
    return `<div class="recommendation-block"><h5>Rebalance recommendations</h5><p class="recommendation-note">${escapeHtml(planningNote)}</p>${noResultNote}<p class="empty-state">Treat this as an action for the next planning cycle, not a confirmed allocation plan.</p></div>`;
  }
  return `<div class="recommendation-block"><h5>Rebalance recommendations</h5><p class="recommendation-note">${escapeHtml(planningNote)}</p>${noResultNote}${candidateGroups
    .map((group) => {
      const warning = group.recommendationDegraded
        ? `<p class="quality-warning"><strong>Evidence degraded:</strong> ${escapeHtml(group.dataQualityFlags.join(', '))}</p>`
        : '';
      const period = `${escapeHtml(group.planningPeriod.from)}${group.planningPeriod.to ? ` to ${escapeHtml(group.planningPeriod.to)}` : ' onward'}`;
      const status = `<p class="recommendation-status status-${escapeHtml(group.status)}"><strong>${escapeHtml(humanize(group.status))}</strong> · Project ${escapeHtml(group.projectId)} · Period ${period} · Required reduction ${number(group.requiredReductionHoursPerWeek)}h/week</p>`;
      const explanation = renderRecommendationExplanation(group);
      return `${status}${warning}${explanation}<div class="candidate-list">${group.recommendations
        .map((candidate) => {
          const target = memberMap.get(candidate.targetMemberId);
          return `<article class="candidate-card">
  <div><strong>#${candidate.rankWithinOpportunity} ${escapeHtml(target?.fullName || candidate.targetMemberId)}</strong><span>${escapeHtml(candidate.confidence.toUpperCase())} · Score ${number(candidate.score)}</span></div>
  <p>${number(candidate.transferHoursPerWeek)}h/week from project ${escapeHtml(candidate.projectId)} · ${escapeHtml(candidate.effectiveFrom)}${candidate.effectiveTo ? ` to ${escapeHtml(candidate.effectiveTo)}` : ' onward'} · Source ${pct(candidate.beforeAfter.sourceBeforeBusyRate)} → ${pct(candidate.beforeAfter.sourceAfterBusyRate)} · Target ${pct(candidate.beforeAfter.targetBeforeBusyRate)} → ${pct(candidate.beforeAfter.targetAfterBusyRate)}</p>
  <p><strong>Matched:</strong> ${escapeHtml(candidate.evidence.matchedSkills.join(', ') || 'None')} · <strong>Missing:</strong> ${escapeHtml(candidate.evidence.missingSkills.join(', ') || 'None')}</p>
  <p><strong>Similar tasks:</strong> ${escapeHtml(candidate.evidence.similarPastTasks.join(', ') || 'Unavailable')}</p>
  <p><strong>Why:</strong> ${escapeHtml(candidate.evidence.rationale)}</p>
  ${candidate.portfolioSelected ? '<span class="selected-badge">Portfolio selected</span>' : '<span class="alternative-badge">Mutually exclusive alternative · revalidate before apply</span>'}
</article>`;
        })
        .join('')}</div>`;
    })
    .join('')}</div>`;
}

function renderRecommendationExplanation(group: RebalanceRecommendationGroup): string {
  if (!group.explanation) return '';
  const tradeoffs = group.explanation.riskTradeoffs.length
    ? `<ul>${group.explanation.riskTradeoffs
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul>`
    : '';
  const topChoice = group.explanation.topChoiceReason
    ? `<p><strong>Why top-1 leads:</strong> ${escapeHtml(group.explanation.topChoiceReason)}</p>`
    : '';
  const alternatives = group.explanation.alternativesComparison
    ? `<p><strong>Alternatives:</strong> ${escapeHtml(group.explanation.alternativesComparison)}</p>`
    : '';
  return `<div class="llm-explanation"><strong>Explanation of deterministic recommendation</strong><p>${escapeHtml(group.explanation.summary)}</p>${topChoice}${alternatives}${tradeoffs}</div>`;
}

function nextIsoDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return 'the next planning period';
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function renderMethodology(): string {
  return `<section class="methodology"><h2>Methodology &amp; definitions</h2>
  <p>Deterministic metrics use persisted PMO member-week facts. Project allocations shown in recommendations are evidence and are not summed into member facts again.</p>
  <table><thead><tr><th>Metric</th><th>Formula</th></tr></thead><tbody>
    <tr><td>N01 Busy rate</td><td>Planned hours / Available hours</td></tr>
    <tr><td>N02 Utilization</td><td>Worked hours / Available hours</td></tr>
    <tr><td>N03 Billable rate</td><td>Billable hours / Worked hours</td></tr>
    <tr><td>N04 Bench rate</td><td>Bench hours / Available hours</td></tr>
    <tr><td>N05 Overtime ratio</td><td>Overtime hours / Standard hours</td></tr>
    <tr><td>N06 Effort consumption</td><td>Actual hours / Planned hours</td></tr>
    <tr><td>N12 Training compliance</td><td>Completed / Required</td></tr>
  </tbody></table></section>`;
}

const CSS = `
@page { size: A4 portrait; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
html { color: #172033; background: #fff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; line-height: 1.45; }
body { margin: 0; }
.report-header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #183b66; padding-bottom: 14px; }
.eyebrow { color: #486581; font-size: 10px; font-weight: 800; letter-spacing: .12em; margin: 0 0 4px; }
h1 { font-size: 27px; line-height: 1.1; margin: 0; color: #102a43; } h2 { font-size: 19px; } h3 { font-size: 15px; margin: 18px 0 8px; } h4 { display: inline; font-size: 16px; margin: 0 8px; } h5 { font-size: 14px; margin: 16px 0 8px; }
.header-meta { display: flex; flex-direction: column; text-align: right; color: #486581; overflow-wrap: anywhere; }
.provenance { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
.provenance div, .summary-card { border: 1px solid #bcccdc; border-radius: 6px; padding: 9px; min-width: 0; }
.provenance span, .summary-card span, .primary-metric span { display: block; color: #52667a; font-size: 10px; text-transform: uppercase; }
.provenance strong { display: block; overflow-wrap: anywhere; }
.summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.summary-card strong { display: block; font-size: 22px; color: #102a43; }
.severity-section { margin-top: 24px; border-top: 4px solid; }
.severity-red { border-color: #a61b1b; } .severity-yellow { border-color: #8a5a00; }
.section-title { display: flex; align-items: center; gap: 9px; } .section-title > span:last-child { margin-left: auto; color: #52667a; }
.severity-label { display: inline-block; border: 1px solid currentColor; border-radius: 3px; font-size: 9px; font-weight: 800; padding: 2px 5px; letter-spacing: .06em; }
.severity-red .severity-label, .finding-red .severity-label { color: #8f1111; background: #fde8e8; }
.severity-yellow .severity-label, .finding-yellow .severity-label { color: #6b4500; background: #fff3c4; }
.finding-card { border: 1px solid #bcccdc; border-left: 6px solid; border-radius: 6px; margin: 10px 0; padding: 12px; break-inside: avoid; page-break-inside: avoid; overflow-wrap: anywhere; }
.finding-red { border-left-color: #a61b1b; background: #fffafa; } .finding-yellow { border-left-color: #9c6b00; background: #fffdf5; }
.finding-heading { display: flex; justify-content: space-between; gap: 16px; } .finding-heading p { color: #52667a; margin: 4px 0 0; }
.primary-metric { text-align: right; min-width: 90px; } .primary-metric strong { font-size: 20px; }
.finding-detail { font-weight: 600; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 9px 0; } thead { display: table-header-group; } th, td { border: 1px solid #bcccdc; padding: 5px 7px; text-align: left; overflow-wrap: anywhere; } th { background: #e9f0f7; color: #243b53; }
.metrics-table th:first-child, .metrics-table td:first-child { width: 12%; } .metrics-table th:last-child, .metrics-table td:last-child { width: 18%; text-align: right; }
.issue-weeks, .context-notes, .suggested-action, .suggested-actions, .recommendation-block, .llm-explanation { margin-top: 10px; padding: 9px; border-radius: 4px; background: #edf2f7; }
.issue-weeks table { background: #fff; } .issue-weeks th:first-child, .issue-weeks td:first-child { width: 12%; } .issue-weeks th:nth-child(2), .issue-weeks td:nth-child(2) { width: 24%; }
.suggested-action { display: flex; gap: 9px; align-items: center; } .suggested-action em { margin-left: auto; color: #7c2d12; }
.suggested-actions em { float: right; color: #7c2d12; } .suggested-actions ul { margin: 6px 0 0; padding-left: 18px; } .suggested-actions li { margin: 4px 0; } .action-code { font-weight: 700; font-size: 10px; letter-spacing: .04em; background: #d0dae7; border-radius: 3px; padding: 1px 5px; } .action-primary .action-code { background: #b6c9db; }
.candidate-card { border: 1px solid #9fb3c8; background: #fff; border-radius: 5px; padding: 9px; margin: 7px 0; break-inside: avoid; } .candidate-card > div { display: flex; justify-content: space-between; gap: 12px; }
.selected-badge, .alternative-badge { display: inline-block; border-radius: 3px; padding: 3px 6px; font-size: 10px; font-weight: 700; } .selected-badge { color: #0c5c36; background: #d9f2e5; } .alternative-badge { color: #594a00; background: #fff4bf; }
.quality-warning { color: #7c2d12; background: #ffedd5; border: 1px solid #fdba74; padding: 6px; }
.recommendation-note { color: #334e68; background: #fff; border: 1px solid #bcccdc; padding: 7px; }
.llm-explanation { background: #f7fafc; border: 1px solid #d9e2ec; }
.llm-explanation p { margin: 6px 0; }
.llm-explanation ul { margin: 6px 0 0; padding-left: 18px; }
.status-partial_relief, .status-no_valid_rebalance_found { border-left: 4px solid #9c6b00; padding-left: 7px; }
.empty-state { color: #52667a; border: 1px dashed #9fb3c8; padding: 9px; }
.methodology { margin-top: 28px; break-before: page; } footer { margin-top: 24px; border-top: 1px solid #bcccdc; padding-top: 8px; color: #627d98; text-align: center; font-size: 10px; }
`;
