# PMO Reusable Report Flow and PDF Delivery Plan

## 1. Mục tiêu

Tách **Generate PMO Report** thành capability nghiệp vụ độc lập, dùng chung cho hai đường vào:

```text
Upload workbook
  -> ingest -> review -> publish -> rebuild persisted facts --+
                                                            |
Canonical DB request -> ensure persisted facts are current --+-> report flow
                                                                 -> HTML
                                                                 -> PDF artifact
```

Kết quả cuối của mỗi report run:

- một payload JSON có schema ổn định để UI/agent dùng;
- một HTML document tự chứa, dùng cùng payload và cùng rule snapshot;
- một PDF được render từ HTML, lưu private trong S3;
- nhân viên `idle`/`overbook` được group theo severity `red`, rồi `yellow`;
- mỗi overbook yellow/red có tối đa số candidate rebalance hợp lệ theo config (mặc định 3, tối đa 5);
- mỗi finding có số liệu, khoảng thời gian, lý do, edge-case context và suggested action;
- report có thể truy vết tenant, actor, source, date range, facts version và rules version.

Report không parse lại Excel, không normalize lại dữ liệu, không đọc staging. Upload path phải publish thành công trước. No-upload path đọc canonical DB và persisted `pmo.member_week_facts`.

Plan này thay thế phần report/PDF trong:

- `docs/plans/report_agent.md`;
- `docs/plans/pmo-report-engine-problem2.md`.

Hai file cũ chỉ dùng làm lịch sử tham khảo. Khi implement, cập nhật đầu hai file đó bằng link đến plan này để tránh assistant làm theo contract cũ.

## 2. Phạm vi và non-goals

### Trong phạm vi

- Report-only path từ canonical DB.
- `publish_then_report` path sau upload.
- Date-range resolution + HITL khi thiếu range.
- Deterministic report engine đọc persisted facts.
- Rule catalog JSON versioned, chuẩn bị đường thay bằng admin-managed rules.
- Company summary, idle, overbook, supporting metrics N01-N06/N12.
- Deterministic rebalance recommendations từ skills, task history và capacity simulation.
- Config số candidate đề xuất, hard-filter thresholds, scoring weights và confidence bands.
- Group finding theo `red`/`yellow`.
- HTML template và PDF artifact private trên S3.
- Download API có RBAC + tenant isolation.
- Report run persistence, audit metadata, retry/idempotency.
- Unit, integration, contract và E2E tests.

### Chưa làm trong đợt này

- Admin UI sửa rule.
- LLM tự tính metric hoặc tự quyết severity.
- Report từ staging preview.
- Public/shareable PDF URL vĩnh viễn.
- Email PDF tự động.
- Tự động coi mismatch là vi phạm.

## 3. Hiện trạng cần giữ hoặc sửa

### Đã có và sẽ tái sử dụng

- `pmo.ingestData.v2` có planner-driven steps và HITL.
- `generate_report` handler đã tồn tại trong ingest workflow.
- `pmo_generateReport` tool đã tồn tại.
- `pmo.member_week_facts` đã persist grain `tenant + member + week`.
- Publish gọi `ensureFactsComputed(tenantId, { sessionId, force: true })`.
- `pmo.report_runs` đã lưu JSON result.
- `getPmoReportDateBounds()` đã lấy khoảng ngày canonical.
- N01-N06/N12 đã có công thức nền.

### Gap phải sửa

1. `generatePmoReport()` hiện build facts lại từ canonical inputs; contract mới phải gọi `ensureFactsComputed()` rồi đọc persisted facts.
2. `reportSource: staging_preview` trái boundary mới; bỏ khỏi public report flow.
3. Report types hiện chỉ có `idle_members` và `overbook_members`; cần contract rộng hơn nhưng vẫn giữ compatibility adapter.
4. Rule resolution hiện rải giữa `overbook_idle_config`, `kpi_norms` và hard-coded defaults; cần một resolved rule snapshot duy nhất.
5. Idle yellow band chưa được encode rõ.
6. `report_runs` chưa có source mode, rule snapshot, HTML/PDF artifact metadata, checksum và failure detail.
7. Chưa có deterministic HTML renderer, PDF worker và download endpoint.
8. Finding hiện thiếu member name/department/manager, per-week evidence, supporting signals và action code.
9. Chưa có production tables/contracts cho `member_skills` và `member_task_history`; hiện chỉ có mock export/script. Recommendation không được đọc mock tables.
10. Chưa có rebalance engine: workload profile, candidate pool, hard filters, capacity simulation, ranking, evidence và portfolio-level capacity reservation.
11. Freshness của persisted facts mới dựa chủ yếu vào timestamp publish; chưa có explicit `factsVersion`/`canonicalDataVersion` để report chứng minh facts current.

## 4. Quyết định kiến trúc cố định

1. **Một report engine, hai entry path.** Upload và no-upload chỉ khác bước chuẩn bị dữ liệu.
2. **Persisted facts là input bắt buộc.** Report engine không gọi `buildMemberWeekFacts()`.
3. **Không filter facts bằng `last_ingestion_session_id` cho report bình thường.** Field này mô tả lần recompute gần nhất, không phải ownership của tất cả canonical rows. `ingestionSessionId` chỉ là lineage của report run sau upload.
4. **Date range bắt buộc.** Date range must be resolved before report compute. For upload path, missing range resolves to uploaded workbook bounds and is shown as the default. For no-upload path, missing range requires user confirmation from canonical DB bounds.
5. **Rule engine deterministic.** JSON/config -> validated rule set -> classification. Không parse chuỗi như `85-110%` trong hot path.
6. **Rule snapshot immutable theo report run.** Admin đổi rule sau này không làm report cũ đổi nghĩa.
7. **JSON payload là source cho HTML.** Không có hai đường tính riêng cho API và PDF.
8. **HTML do code render và escape.** LLM không được trả raw HTML/CSS.
9. **PDF render bằng headless Chromium trong graphile-worker.** Server chỉ enqueue/read/download; không giữ browser process trong request/chat path.
10. **Artifact private trong S3.** Download qua authenticated API hoặc presigned GET ngắn hạn.
11. **Idempotent job.** `report_run_id` là job key; retry ghi đè cùng S3 key và kiểm tra checksum.
12. **Mọi DB query tenant-scoped; RBAC re-check tại public API/tool.**
13. **Recommendation chỉ dành cho overbook yellow/red.** Idle member là candidate nhận workload, không phải source cần giảm workload.
14. **Constraint trước ranking.** Candidate score không bao giờ override capacity, availability, skill coverage hoặc tenant constraint.
15. **Recommendation là advisory.** Không mutate resource allocation; mọi write/rebalance thật cần workflow + HITL riêng.
16. **Mỗi explicit request tạo `report_run_id` mới.** V1 không dedupe theo request hash. Worker dùng job key `pmo-report:<reportRunId>` để retry idempotent.
17. **Freshness có version.** Report snapshot lưu `factsVersion` và `canonicalDataVersion`, không chỉ `factsComputedAt`.

## 5. Rule baseline từ ảnh

### 5.1 Config baseline

```json
{
  "configId": "CFG-001",
  "ruleName": "SETA-08-SOP-001 RAG thresholds",
  "effectiveDate": "2026-01-01",
  "overbookThreshold": 1.1,
  "overbookRedThreshold": 1.2,
  "idleRedThreshold": 0.75,
  "idleYellowThreshold": 0.85,
  "mismatchPctThreshold": 0.2,
  "otMaxHoursPerWeek": 48
}
```

`idleYellowThreshold = 0.85` được suy ra từ N01 Green `85-110%`. Phải ghi rõ trong rule file và test; không để implicit trong code.

### 5.2 KPI bands

| ID | Metric | Formula | Green | Yellow | Red | Vai trò |
|---|---|---|---|---|---|---|
| N01 | Busy Rate | `planned_h / available_h` | 85-110% | 75-<85%, >110-<120% | <75%, >=120% | Primary idle/overbook |
| N02 | Utilization Rate | `worked_h / available_h` | 75-90% | 60-<75%, >90-100% | <60%, >100% | Supporting burnout/workload signal |
| N03 | Billable Rate | `billable_h / worked_h` | >=80% | 70-<80% | <70% | Supporting revenue signal |
| N04 | Bench Rate | `bench_h / available_h` | <=10% | >10-20% | >20% | Supporting idle/capacity signal |
| N05 | Overtime Ratio | `ot_h / standard_h` | <=5% | >5-15% | >15% | Supporting burnout/OT signal |
| N06 | Effort Consumption | `actual_h / planned_h` | 85-110% | >75-<85%, >110-<120% | <=75%, >=120% | RA-timesheet mismatch |
| N12 | Training Compliance | `done / required` | 100% | 85-<100% | <85% | Edge-case/training context |

### 5.3 Historical ambiguity and locked semantics

Ảnh có vài boundary không hoàn toàn khớp:

- config dùng overbook yellow `1.1`, red `1.2`; bảng viết yellow `111-119%`, red `>120%`;
- N06 ghi yellow `75-84%`, nhưng red `<=75%` nên giá trị đúng 75% bị overlap;
- N01 không ghi idle yellow, trong khi Green bắt đầu tại 85% và Red dưới 75%.

Locked canonical semantics:

- so sánh ratio gốc, không so sánh phần trăm đã round;
- N01: red `<0.75`, yellow `>=0.75 && <0.85`, green `>=0.85 && <=1.10`, yellow `>1.10 && <1.20`, red `>=1.20`;
- N06: red `<=0.75 || >=1.20`, yellow `>0.75 && <0.85 || >1.10 && <1.20`;
- N02-N05/N12 dùng boundary trong bảng trên;
- display percentage có thể round, classification luôn dùng raw ratio.

Các boundary trên đã được product khóa. Agent implement không hỏi xác nhận lại. Nếu requirement
thay đổi sau này, sửa versioned JSON fixture + golden tests; không sửa thuật toán rải rác.

### 5.4 Rule JSON draft

Tạo `config/pmo-report-rules/default.v1.json`:

```json
{
  "schemaVersion": 1,
  "ruleSetId": "SETA-08-SOP-001",
  "version": "2026-01-01",
  "effectiveFrom": "2026-01-01",
  "classification": {
    "primaryMetric": "N01",
    "idle": {
      "red": { "lt": 0.75 },
      "yellow": { "gte": 0.75, "lt": 0.85 }
    },
    "healthy": { "gte": 0.85, "lte": 1.1 },
    "overbook": {
      "yellow": { "gt": 1.1, "lt": 1.2 },
      "red": { "gte": 1.2 }
    }
  },
  "metrics": {
    "N02": {
      "formula": "worked_h / available_h",
      "bands": {
        "green": [{ "gte": 0.75, "lte": 0.9 }],
        "yellow": [{ "gte": 0.6, "lt": 0.75 }, { "gt": 0.9, "lte": 1 }],
        "red": [{ "lt": 0.6 }, { "gt": 1 }]
      }
    },
    "N03": {
      "formula": "billable_h / worked_h",
      "bands": {
        "green": [{ "gte": 0.8 }],
        "yellow": [{ "gte": 0.7, "lt": 0.8 }],
        "red": [{ "lt": 0.7 }]
      }
    },
    "N04": {
      "formula": "bench_h / available_h",
      "bands": {
        "green": [{ "lte": 0.1 }],
        "yellow": [{ "gt": 0.1, "lte": 0.2 }],
        "red": [{ "gt": 0.2 }]
      }
    },
    "N05": {
      "formula": "ot_h / standard_h",
      "bands": {
        "green": [{ "lte": 0.05 }],
        "yellow": [{ "gt": 0.05, "lte": 0.15 }],
        "red": [{ "gt": 0.15 }]
      }
    },
    "N06": {
      "formula": "actual_h / planned_h",
      "bands": {
        "green": [{ "gte": 0.85, "lte": 1.1 }],
        "yellow": [{ "gt": 0.75, "lt": 0.85 }, { "gt": 1.1, "lt": 1.2 }],
        "red": [{ "lte": 0.75 }, { "gte": 1.2 }]
      }
    },
    "N12": {
      "formula": "done / required",
      "bands": {
        "green": [{ "gte": 1 }],
        "yellow": [{ "gte": 0.85, "lt": 1 }],
        "red": [{ "lt": 0.85 }]
      }
    }
  },
  "limits": {
    "mismatchPctThreshold": 0.2,
    "otMaxHoursPerWeek": 48
  },
  "recommendation": {
    "enabled": true,
    "candidateCount": {
      "default": 3,
      "min": 1,
      "max": 5
    },
    "historyWindowDays": 90,
    "transferStepHours": 4,
    "minimumSkillCoverage": 0.5,
    "idealTargetBusyRate": 0.95,
    "capacityFitTolerance": 0.25,
    "maxScenariosPerSource": 100,
    "taskHistoryTopK": 3,
    "scoring": {
      "skillCoverage": 0.35,
      "taskHistorySimilarity": 0.35,
      "capacityFit": 0.2,
      "projectContext": 0.1
    },
    "confidence": {
      "high": { "gte": 0.8 },
      "medium": { "gte": 0.6 },
      "low": { "gte": 0.5 }
    },
    "adjacentSkills": {}
  },
  "reportLimits": {
    "maxWeeks": 26,
    "maxMembersForPdf": 1000,
    "maxFindingsForPdf": 2000
  }
}
```

Validator phải reject overlap, gap ngoài các gap được khai báo, NaN, ratio âm, unknown metric,
invalid effective date, candidate-count range sai và scoring weights không có tổng bằng `1`.

`candidateCount.default` là số recommendation mong muốn cho mỗi overbook finding. Caller có thể yêu
cầu từ `1` đến `5`; v1 mặc định/top 3. Nếu hard filters chỉ tìm được 1-2 candidate, trả số candidate
hợp lệ thực tế cùng reason; không thêm candidate invalid để đủ quota. `adjacentSkills` thuộc cùng
versioned rule catalog, ban đầu do PMO/product + tech lead quản lý; admin-managed ở phase sau.

## 6. Contract đích

### 6.1 Request

```ts
type GeneratePmoReportRequest = {
  sourceMode: 'after_upload_publish' | 'canonical_db';
  ingestionSessionId?: string;
  dateRange: {
    from: string;
    to: string;
    granularity: 'week' | 'month';
  };
  reportTypes: Array<
    'company_ra_summary' | 'overbook_idle' | 'ra_timesheet_mismatch'
  >;
  filters?: {
    memberIds?: string[];
    projectIds?: string[];
    departments?: string[];
    lineManagerIds?: string[];
  };
  recommendation?: {
    enabled: boolean;
    candidateCount?: number; // validated against resolved rule min/max; default from rule
  };
  outputFormats: Array<'json' | 'html' | 'pdf'>;
};
```

`tenantId` và actor không nhận từ model/user payload. Lấy từ trusted request context.

### 6.2 Result

```ts
type PmoReportResult = {
  reportRunId: string;
  status: 'queued' | 'computing' | 'rendering' | 'completed' | 'failed';
  source: {
    mode: 'after_upload_publish' | 'canonical_db';
    ingestionSessionId: string | null;
    factsComputedAt: string;
    factsVersion: string;
    canonicalDataVersion: string;
  };
  dateRange: { from: string; to: string; granularity: 'week' | 'month' };
  ruleSnapshot: {
    ruleSetId: string;
    version: string;
    effectiveFrom: string;
    sha256: string;
    resolvedRules: unknown;
  };
  summary: {
    memberCount: number;
    healthyCount: number;
    redCount: number;
    yellowCount: number;
    overbookRedCount: number;
    overbookYellowCount: number;
    idleRedCount: number;
    idleYellowCount: number;
    mismatchCount: number;
    excludedWeekCount: number;
  };
  severityGroups: {
    red: PmoReportFinding[];
    yellow: PmoReportFinding[];
  };
  recommendations: RebalanceRecommendationGroup[];
  artifacts: {
    html?: ReportArtifact;
    pdf?: ReportArtifact;
  };
};
```

`PmoReportFinding` tối thiểu gồm:

- `memberId`, `fullName`, `department`, `roleTitle`, `lineManagerId`;
- `issueType: idle | overbook`;
- `severity: red | yellow`;
- member-level N01 và N06;
- supporting signals N02-N05/N12;
- hours totals: available/planned/actual/billable/bench/OT/training;
- affected week list + per-week evidence;
- exclusions/annotations;
- stable `actionCode` và deterministic suggested action text cho non-rebalance actions;
- `reviewRequired: true` cho mismatch; không dùng từ “violation” mặc định.

Finding và recommendation là hai collections riêng. `PmoReportFinding` không nhúng candidate list để
tránh duplicate payload và cho phép một recommendation liên kết nhiều affected weeks.

```ts
type RebalanceRecommendationGroup = {
  sourceFindingId: string;
  sourceMemberId: string;
  weekId: string;
  status: 'full_solution' | 'partial_relief' | 'no_valid_rebalance_found';
  requiredReductionHours: number;
  requestedCandidateCount: number;
  validCandidateCount: number;
  recommendationDegraded: boolean;
  dataQualityFlags: Array<
    | 'missing_task_history'
    | 'missing_task_embeddings'
    | 'stale_skill_projection'
    | 'stale_task_history_projection'
    | 'embedding_provider_unavailable'
  >;
  recommendations: RebalanceRecommendation[];
  noResultReasons: string[];
};

type RebalanceRecommendation = {
  type: 'rebalance';
  sourceMemberId: string;
  targetMemberId: string;
  projectId: string;
  weekId: string;
  transferHours: number;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  beforeAfter: {
    sourceBeforeBusyRate: number;
    sourceAfterBusyRate: number;
    targetBeforeBusyRate: number;
    targetAfterBusyRate: number;
  };
  scoreBreakdown: {
    skillCoverage: number;
    taskHistorySimilarity: number;
    capacityFit: number;
    projectContext: number;
  };
  evidence: {
    matchedSkills: string[];
    missingSkills: string[];
    similarPastTasks: Array<{
      taskId: string;
      title: string;
      similarity: number;
      occurredAt: string;
    }>;
    capacityReason: string;
  };
};
```

## 7. Phases triển khai

## Phase 0 — Chốt contract, baseline và test fixtures

**Mục tiêu:** assistant sau không phải đoán boundary hoặc tự phát minh output.

1. Đọc lại `packages/pmo/docs/formulas.md`, `analytics-compute-contract.md`, hai plan cũ và code analytics hiện tại.
2. Encode locked boundary ở mục 5.3 thành fixtures/tests; không hỏi product xác nhận lại.
3. Chọn fixture cố định gồm ít nhất 12 member-week:
   - idle red, idle yellow;
   - healthy lower/upper boundary;
   - overbook yellow, overbook red;
   - exactly 75%, 85%, 110%, 120%;
   - leave, holiday, training, approved OT;
   - RA nhiều project cùng member/week để bắt double-count;
   - mismatch under/over;
   - overbook source có 0, 2, 3 và 5 valid replacement candidates;
   - candidate score cao nhưng fail capacity để chứng minh hard filter thắng ranking;
   - hai source cạnh tranh cùng target để bắt double-book capacity.
4. Viết golden expected JSON và expected severity order trước code.
5. Cập nhật `packages/pmo/docs/formulas.md` thành contract thống nhất; xóa mô tả OT/training mâu thuẫn.
6. Thêm link “superseded by” vào hai plan cũ.

**Exit criteria**: locked boundary table đã được encode vào fixtures/golden tests; expected outputs không còn TODO.

## Phase 1 — Rule catalog JSON và resolver

**Mục tiêu:** một resolved rule set có version/hash, chưa cần admin UI.

**Status:** implemented 2026-06-21. Rule catalog, fail-fast boot validation, resolver/source adapter,
canonical SHA-256, legacy compatibility audit và focused tests đã có.

1. Tạo `config/pmo-report-rules/default.v1.json` theo mục 5.4.
2. Tạo Zod schemas tại `packages/pmo/src/backend/reporting/rules/schema.ts`.
3. Tạo `validateRuleSet()`:
   - kiểm tra comparator hợp lệ;
   - kiểm tra band overlap/gap;
   - kiểm tra known metrics/formulas;
   - kiểm tra threshold order;
   - trả error có JSON path.
4. Tạo loader tại `reporting/rules/load.ts`, dùng cùng repo/app-home resolution pattern với planner catalog.
5. Tạo `resolveReportRules({ tenantId, effectiveAt })`:
   - v1 đọc JSON baseline;
   - adapter interface sẵn cho DB/admin source;
   - resolve rule active theo `effectiveFrom`;
   - canonical JSON serialization + SHA-256.
6. Không xóa `overbook_idle_config`/`kpi_norms`; tạo compatibility mapper và log mismatch giữa canonical rows với JSON baseline.
7. Export contract cần thiết qua `packages/pmo/src/index.ts` hoặc `/contracts`, không deep import.
8. Tests:
   - exact boundary tests;
   - overlap/gap rejection;
   - effective-date selection;
   - stable hash bất kể object key order;
   - candidate count default/min/max;
   - scoring weights sum bằng `1`;
   - fallback khi file config thiếu/invalid phải fail boot, không silent defaults.

**Exit criteria:** mọi classification threshold đến từ `ResolvedReportRules`; không thêm hard-coded band mới.

## Phase 2 — Persisted facts contract và deterministic classification

**Mục tiêu:** report engine không tính lại fact từ raw canonical rows.

**Status:** implemented 2026-06-21. Report path chỉ đọc bounded persisted facts; freshness dùng
`canonicalDataVersion` + `factsVersion` + immutable rule hash; ratio-of-sums, boundary/context rules,
supporting metric classification, stable action codes và Drizzle migration đã có.

1. Viết failing integration test chứng minh `generatePmoReport()` chỉ đọc persisted facts.
2. Mở rộng `loadMemberWeekFacts()` nhận bounded date range bằng join tenant-scoped với `calendar_weeks`; không tải toàn tenant rồi filter memory.
3. Tạo `loadReportEvidence()` để load song song:
   - member identity/context;
   - calendar weeks;
   - leave/holiday/training/approved OT context;
   - optional project allocations cho drill-down;
   - tất cả query có tenant filter và date bounds.
4. Report entry gọi `ensureFactsComputed(tenantId, { force: false })` trước load.
5. Định nghĩa freshness/version rõ:
   - `canonicalDataVersion`: deterministic watermark từ max `updated_at` của canonical tables ảnh hưởng analytics + latest published session id/time;
   - `factsVersion`: SHA-256 của `tenantId + canonicalDataVersion + facts rule/input schema version`;
   - lưu hai version trong metadata của facts computation, không suy ra current chỉ từ wall-clock;
   - `ensureFactsComputed(force=false)` recompute khi facts thiếu hoặc stored `canonicalDataVersion` khác current;
   - report persist cả hai version để audit.
6. Upload path giữ `force: true` sau publish; report không force lần hai nếu version đã match.
7. Tạo pure functions:
   - `aggregateMemberFacts()` tại grain member sau khi facts đã aggregate member/week;
   - `classifyPrimaryBusyRate()` từ N01;
   - `classifySupportingMetrics()` từ N02-N06/N12;
   - `applyContextRules()`;
   - `buildSuggestedActions()` từ stable action codes.
8. Chống double-count RA:
   - không sum project allocation sau khi đã dùng member-week fact;
   - project rows chỉ là evidence;
   - test nhiều project vẫn chỉ dùng `member_week_facts.planned_hours` một lần.
9. Edge-case rules:
   - pre-hire và `available_h = 0` không thành idle;
   - partial leave/holiday điều chỉnh denominator:
     `available_h = standard_h - approved_leave_h - holiday_h`;
   - full leave/full holiday hoặc `available_h = 0` bị exclude khỏi idle/overbook;
   - training và approved OT là annotation/supporting context, không exclusion mặc định và không tự
     động đổi red thành green;
   - OT > 48h/week tạo red supporting signal;
   - mismatch tạo issue + `reviewRequired`, không tự động tạo compliance verdict.
10. Member-level N01 bắt buộc dùng ratio-of-sums:
    `sum(planned_h) / sum(available_h)`, không mean weekly ratios.
11. Mở rộng types/schema DB nếu cần lưu classification/freshness metadata mới. Generate migration bằng:

   ```bash
   pnpm --filter @seta/pmo db:generate
   pnpm db:migrate
   ```

12. Không sửa migration đã commit.

**Exit criteria:** report result đổi khi persisted facts đổi; không đổi khi raw/staging data đổi mà facts chưa recompute.

## Phase 2.5 — Deterministic rebalance recommendation engine

**Mục tiêu:** với mỗi overbook yellow/red, tìm top 3 candidate khi đủ dữ liệu, cho phép request từ 1
đến 5 candidate, có before/after simulation và evidence. Không tạo recommendation cho idle finding.
Không write allocation.

**Status:** implemented 2026-06-21. PMO-local skill/task projections, idempotent sync contract,
deterministic workload/skill/history/capacity/project scoring, hard filters, full/partial/no-result status,
candidate-count validation, portfolio top-1 reservation và report payload integration đã có.

### 2.5.1 — Production data contracts

1. Xác nhận source-of-truth production cho skills/task history. Repo hiện chỉ có mock
   `pmo_member_skills`/`pmo_member_task_history` trong script, không có PMO Drizzle schema.
2. Source-of-truth runtime cố định là PMO local projections:
   - `pmo.member_skills_projection`;
   - `pmo.task_history_projection`;
   - có `source`, `synced_at`, `source_version`/`version` và idempotency key;
   - sync từ identity/planner public surfaces hoặc domain events qua idempotent subscribers;
   - report hot path không gọi trực tiếp identity/planner.
3. Không deep-import identity/planner. Không raw SQL cross-schema. Không cross-schema FK.
4. Định nghĩa mapping ổn định giữa `pmo.member_master.member_id` và identity user khi sync skill từ
   identity. Missing mapping phải tạo explicit `candidate_data_unavailable`, không fuzzy-match bằng name.
5. Data contract tối thiểu:
   - member skill: member, normalized skill key/name, level nếu có, source, observed/updated time;
   - task history: task, member, project, title/summary, skill tags, occurred/completed time, evidence confidence;
   - task embedding/model id/source hash nếu similarity dùng vector.
6. Nếu tạo tables, generate migration bằng PMO CLI; thêm tenant indexes, member/date indexes và natural
   idempotency keys.
7. Viết backfill path và freshness contract cho skill/task projections trước khi bật recommendation.

### 2.5.2 — Engine contracts và workload profile

1. Tạo `packages/pmo/src/backend/reporting/recommendations/`:

   ```text
   recommendations/
     contracts.ts
     load-evidence.ts
     workload-profile.ts
     candidate-pool.ts
     skill-coverage.ts
     task-similarity.ts
     capacity-simulation.ts
     project-context.ts
     rank.ts
     generate.ts
   ```

2. Chỉ nhận overbook findings có `severity: yellow|red` và `busyRate > greenMax`.
3. Chạy ở grain `source member + week`; dùng project-week allocation làm transfer unit v1.
4. Với source A, tính deterministic:

   ```ts
   requiredReductionHours =
     max(0, plannedHoursA - greenMax * availableHoursA);
   ```

5. Xác định project workload của A trong week. Sort theo transferable hours giảm dần rồi project ID để
   reproducible. MVP mỗi scenario chuyển từ một project; multi-project scenario để phase sau.
6. Build workload profile từ source member + project + history window:
   - role;
   - normalized skill tags;
   - domain/product/client tags nếu có evidence;
   - recent tasks;
   - workload embedding + model/source hash.
7. Skill tags từ structured source ưu tiên trước; extraction từ task text qua schema-validated pipeline.
   LLM/RAG không được invent skill không có evidence.

### 2.5.3 — Candidate pool và hard filters

1. Candidate pool cùng tenant/date range, khác source member, active và có `availableHours > 0`.
2. Availability handling:
   - leave/holiday giảm available capacity theo giờ; full leave/holiday loại candidate-week;
   - training không loại cả week; tính như scheduled-load conflict và giảm headroom đúng slot/giờ;
   - approved OT chỉ là context, không tự tăng target capacity trừ khi versioned rule cho phép.
3. Tính equal-weight skill coverage, không manual skill weight:

   ```ts
   skillCoverageScore = average(requiredSkills.map(matchScore));
   // exact + enough level = 1.0
   // exact + lower level  = 0.7
   // adjacent skill       = 0.5
   // missing              = 0
   ```

4. Adjacent-skill taxonomy nằm trong versioned PMO report/recommendation config, owner ban đầu là
   PMO/product + tech lead; không hard-code trong scoring, không để LLM tự suy diễn.
5. Generate `transferHours` theo `transferStepHours`. Full-relief starting point:

   ```ts
   roundedReliefHours =
     ceil(requiredReductionHours / transferStepHours) * transferStepHours;
   ```

   Cho phép round lên, kể cả `requiredReductionHours` không chia hết cho step, miễn:
   - `roundedReliefHours` không vượt project transferable hours của source;
   - `roundedReliefHours` không vượt target capacity headroom tới `greenMax`;
   - source sau transfer không dưới `greenMin`;
   - target sau transfer không trên `greenMax`.

   Nếu rounded value vi phạm, thử smaller steps cho `partial_relief`; không silently round xuống rồi gọi
   `full_solution`.
6. Simulate:

   ```ts
   sourceAfterPlannedHours = sourcePlannedHours - transferHours;
   targetAfterPlannedHours = targetPlannedHours + transferHours;
   sourceAfterBusyRate = sourceAfterPlannedHours / sourceAvailableHours;
   targetAfterBusyRate = targetAfterPlannedHours / targetAvailableHours;
   ```

7. Full solution hợp lệ khi:
   - `skillCoverageScore >= minimumSkillCoverage`;
   - `sourceAfterBusyRate >= greenMin && sourceAfterBusyRate <= greenMax`;
   - `targetAfterBusyRate <= greenMax`;
   - không availability conflict.
8. Mặc định chỉ rank full-green solutions. Partial solution chỉ được giữ khi không có full solution,
   làm giảm overbook đáng kể và không làm target vượt green max. Status group là `partial_relief`,
   không xếp ngang full recommendation và không mô tả như solved.
9. Không có scenario hợp lệ: trả `no_valid_rebalance_found` + machine-readable reasons.
10. Hard-filter failures không đi vào ranking, kể cả similarity/skill score rất cao.

### 2.5.4 — Task-history similarity và ranking

1. Lấy task history trong `historyWindowDays`, cùng tenant, ưu tiên project/workload tương ứng.
2. Score từng task:

   ```ts
   recencyWeight = exp(-daysAgo / historyWindowDays);
   singleTaskHistoryScore =
     cosineSimilarity(workloadEmbedding, taskEmbedding) *
     recencyWeight *
     evidenceConfidence;
   taskHistorySimilarityScore = average(topK(singleTaskHistoryScore));
   ```

3. Không có task history/vector hoặc embedding provider lỗi: score thành phần bằng `0`, ghi degradation
   reason; set `recommendationDegraded: true` + matching `dataQualityFlags`; engine vẫn có thể đề xuất
   nếu structured skills + capacity đủ.
4. Capacity fit:

   ```ts
   capacityFitScore =
     1 - min(abs(targetAfterBusyRate - idealTargetBusyRate) / capacityFitTolerance, 1);
   ```

5. Project context deterministic mapping:
   - same project `1.0`;
   - same product/client/domain `0.8`;
   - same tech stack/module `0.6`;
   - same department/role family `0.4`;
   - unrelated `0.0`.
6. Final score từ resolved config:

   ```ts
   candidateScore =
     0.35 * skillCoverageScore +
     0.35 * taskHistorySimilarityScore +
     0.20 * capacityFitScore +
     0.10 * projectContextScore;
   ```

7. Confidence từ config thresholds; không để LLM gán.
8. Stable sort: score giảm dần, skill coverage, task similarity, target member ID.
9. Chọn requested candidate count đã validate trong `[1,5]`; mặc định/top 3.
10. Nếu chỉ có N valid candidates, trả N. Không pad bằng candidate fail hard constraints.

### 2.5.5 — Portfolio-level reservation

1. Không rank độc lập rồi dùng cùng target capacity cho nhiều source.
2. Sau khi có per-source scenarios, chạy deterministic portfolio selector:
   - process source red trước yellow;
   - trong severity, process required reduction giảm dần rồi member ID;
   - reserve target member-week capacity cho recommendation đã chọn;
   - re-simulate scenario sau mỗi reservation;
   - loại scenario làm target vượt `greenMax`.
3. Output phân biệt `rankWithinSource` và `portfolioSelected`.
4. MVP reserve toàn cục cho top-1 recommendation mỗi source. Candidate 2-5 là mutually exclusive
   alternatives, phải ghi rõ trong JSON/HTML/PDF và revalidate trước apply. Global optimizer để v2.

### 2.5.6 — Persistence và tests

1. Persist recommendations trong immutable report payload, cùng rule/facts/embedding version evidence.
2. Không tạo allocation mutation/event từ recommendation generation.
3. Unit tests cho mọi formula, division-by-zero, transfer steps, hard filters, score breakdown, stable sort,
   count 1/default 3/max 5, partial/no-result và graceful embedding degradation.
4. Integration tests real Postgres cho tenant isolation, skill/task projections, multiple projects và
   portfolio capacity contention.
5. Golden test chứng minh cùng facts/evidence/config/version tạo cùng recommendations.

**Exit criteria:** mỗi overbook finding có tối đa configured 1-5 valid candidates (top 3 mặc định) hoặc explicit
`partial_relief`/`no_valid_rebalance_found`; idle finding không sinh source recommendation; không target
nào bị overbook bởi portfolio-selected scenarios.

## Phase 3 — Reusable report application service

**Mục tiêu:** tool, workflow và HTTP dùng cùng một service.

**Status:** implemented 2026-06-21. `createReportRun` + `computeReportPayload` + `generateReport`
đã gom validation, publish ownership, bounded range, immutable rule snapshot, queued/computing/completed
persistence, deterministic sorting, recommendation integration và PDF limits. Agent tool và ingest workflow
dùng cùng service; public staging-preview path bị reject có deprecation test.

1. Tạo folder `packages/pmo/src/backend/reporting/`:

   ```text
   reporting/
     contracts.ts
     generate-report.ts
     report-repository.ts
     date-range.ts
     rules/
     render/
     jobs/
   ```

2. Tạo `createReportRun()`:
   - validate source mode;
   - với `after_upload_publish`, verify tenant-owned session status `published`;
   - với `canonical_db`, không yêu cầu ingestion session;
   - validate date range và max range policy;
   - reject PDF request quá 26 tuần, quá 1,000 members hoặc quá 2,000 findings; yêu cầu filter hoặc
     chuyển sang JSON/CSV async export riêng;
   - snapshot resolved rules;
   - insert run status `queued`.
3. Tạo deterministic `computeReportPayload(reportRunId)`:
   - lock/update status `computing`;
   - ensure facts;
   - load bounded facts/evidence;
   - aggregate/classify;
   - chạy rebalance recommendation engine cho overbook yellow/red khi enabled;
   - portfolio reservation chỉ áp dụng cho top-1 có `portfolioSelected=true`;
   - alternatives 2-5 giữ nguyên, đánh dấu mutually exclusive và bắt buộc revalidate trước apply;
   - sort `red` trước `yellow`; trong group sort overbook/idle rồi severity score giảm dần, cuối cùng `memberId` để ổn định;
   - persist JSON payload + summary + rules snapshot;
   - không gọi LLM.
4. Chuẩn hóa report types mới. Giữ adapter từ `idle_members`/`overbook_members` để không phá chat cũ.
5. `pmo_generateReport` gọi service, không gọi analytics implementation trực tiếp.
6. `generate_report` workflow handler gọi cùng service.
7. No-upload path:
   - PMO Agent resolve explicit range;
   - nếu thiếu, gọi bounds helper và hỏi user;
   - sau confirm, tạo report run với `canonical_db`.
8. Upload path:
   - planner giữ `publish_then_report`;
   - `publish_after_approval` hoàn tất + facts rebuild;
   - `generate_report` verify published checkpoint rồi tạo run;
   - reject report-range không rollback publish.
9. Loại `staging_preview` khỏi public contract; nếu demo còn dùng thì giữ internal legacy adapter với deprecation test.

**Exit criteria:** cùng request/facts/rules tạo cùng JSON bất kể gọi từ tool hay ingest workflow.

## Phase 4 — Report run schema và auditability

**Mục tiêu:** durable state cho compute/render/retry/download.

**Status:** implemented 2026-06-21. `report_runs` có version/rule/facts/recommendation/artifact/failure
metadata và DB status/source constraints; repository dùng CAS cho mọi transition, transactional outbox
events cho requested/completed/failed, deterministic graphile job key, retry guard và artifact identity
checks. Migration `0008_red_wallop.sql` được generate bằng Drizzle CLI.

1. Mở rộng `pmo.report_runs`:
   - `source_mode`;
   - nullable `ingestion_session_id`;
   - `granularity`, filters JSON;
   - `rule_set_id`, `rule_version`, `rule_sha256`, `rule_snapshot` JSON;
   - `facts_computed_at`, `facts_version`, `canonical_data_version`;
   - `recommendation_config_snapshot`, `embedding_model_id`, `embedding_source_version` nếu recommendation enabled;
   - `html_s3_key`, `html_sha256`, `html_size_bytes`;
   - `pdf_s3_key`, `pdf_sha256`, `pdf_size_bytes`, `pdf_page_count` nếu renderer trả được;
   - `failure_code`, sanitized `failure_message`;
   - `started_at`, `completed_at`, `updated_at`;
   - status constraint ở app schema: `queued|computing|rendering|completed|failed`.
2. Idempotency strategy cố định:
   - mỗi explicit user request luôn tạo `report_run_id` mới;
   - v1 không unique/dedupe theo request hash;
   - graphile job key là `pmo-report:<reportRunId>`;
   - retry cùng run ghi đè cùng artifact keys và compare checksum.
3. Mọi status transition qua repository function có compare-and-set; retry không được chuyển `completed` về `rendering` nếu artifact hợp lệ.
4. Dùng `withEmit(session, ...)` khi report run mutation cần emit audit/domain event; state change và `core.events` cùng transaction.
5. Định nghĩa events trong `@seta/pmo/events`:
   - `pmo.report.requested`;
   - `pmo.report.completed`;
   - `pmo.report.failed`.
6. Event payload không chứa full findings/PII; chỉ IDs, counts, hashes, status.
7. Migration chỉ tạo qua CLI.

**Exit criteria:** có thể restart server/worker mà run queued/rendering vẫn retry được và report completed vẫn download được.

## Phase 5 — HTML document renderer

**Mục tiêu:** semantic HTML tự chứa, deterministic, print-ready.

**Status:** implemented 2026-06-21. Persisted render-model loader, member/metric evidence enrichment,
standalone semantic A4 HTML, inline print CSS, red/yellow + overbook/idle grouping, recommendation evidence,
degraded/partial/no-result labels, universal escaping và SHA-256/byte-size output đã có.

1. Tạo `reporting/render/render-report-html.ts`; input duy nhất là persisted `PmoReportResult`/render model.
2. Không đưa raw LLM text vào template. Escape toàn bộ user/canonical strings: name, department, project, action text.
3. HTML structure:
   - cover/header: report title, date range, generated time, source mode;
   - rule/version box;
   - company summary cards;
   - `Red severity` section;
   - `Yellow severity` section;
   - trong mỗi section chia `Overbook` và `Idle`;
   - employee cards/table rows với màu nền + left border rõ;
   - metric evidence table N01-N06/N12;
   - exclusions/context notes;
   - suggested action;
   - dưới mỗi overbook finding: top configured 1-5 rebalance candidates (mặc định 3),
     score/confidence, transfer hours,
     before/after busy rates, matched/missing skills và similar-task evidence;
   - hiện warning/evidence-quality badge khi `recommendationDegraded=true`, kèm `dataQualityFlags`;
   - `partial_relief` và `no_valid_rebalance_found` phải hiện rõ, không render như solved;
   - idle finding không có “replace task” recommendation;
   - methodology/definitions appendix.
4. Accessibility/print:
   - không dùng màu làm tín hiệu duy nhất; luôn có label `RED`/`YELLOW` + issue text;
   - contrast đạt WCAG AA;
   - `thead { display: table-header-group; }`;
   - `break-inside: avoid` cho employee card;
   - page number/footer qua Chromium header/footer template;
   - A4 portrait cố định cho v1; evidence rộng dùng wrapping/appendix, không tự chuyển landscape;
   - header v1 chỉ có title, tenant/company name dạng text, date range, generated time, rule version;
     không tải/render company logo.
5. CSS inline trong HTML, không thêm `.css` ngoài `packages/shared-ui` để không vi phạm `lint:styles`.
6. Không nhúng external font/image URL; dùng system font stack để PDF reproducible/offline.
7. Tạo HTML checksum từ bytes cuối cùng.
8. Golden/snapshot tests:
   - red xuất hiện trước yellow;
   - employee escaping chống HTML injection;
   - empty red/yellow sections có explicit “No findings”;
   - long name/action không phá layout;
   - deterministic HTML khi fixed `generatedAt`.

**Exit criteria:** HTML mở standalone, đúng group/highlight, không cần network request.

## Phase 6 — HTML-to-PDF worker và S3 artifact

**Status:** implemented 2026-06-21. PDF payload dừng ở `rendering` cho tới khi private HTML/PDF
artifacts và checksums được persist; graphile task dùng serialized `pmo-report-pdf` queue,
Chromium offline A4, bounded retry/final failure, retry-resume không rerender artifact đã persist,
Docker Chromium + env/hosting contract và runtime-gated Chromium integration test.

**Mục tiêu:** PDF production-grade, không block chat/server request.

1. Cài dependency bằng CLI, không sửa version tay. Chọn Playwright/Chromium implementation sau spike nhỏ nhưng contract cố định là HTML -> headless Chromium -> PDF. Ví dụ:

   ```bash
   pnpm --filter @seta/pmo add playwright-core
   ```

2. Cập nhật runtime image bằng Chromium Alpine package tương thích; cấu hình executable path qua env được khai báo trong `.env.example`.
3. Tạo graphile-worker task `pmo.report.render_pdf` trong PMO module contribution, không hard-code trực tiếp vào `apps/worker` nếu registry hỗ trợ jobs.
4. Enqueue với:
   - payload `{ reportRunId, tenantId }`;
   - job key `pmo-report:<reportRunId>`;
   - bounded retries + exponential backoff;
   - queue concurrency thấp để bảo vệ memory/CPU.
5. Worker flow:
   - re-load run tenant-scoped;
   - no-op nếu completed và checksums/artifacts tồn tại;
   - compute payload nếu chưa có;
   - render HTML;
   - upload HTML private S3 key `tenants/<tenant>/pmo/reports/<run>/report.html`;
   - launch Chromium với network disabled;
   - `page.setContent(html, { waitUntil: 'load' })`;
   - render A4 PDF với backgrounds/header/footer;
   - validate `%PDF-` magic bytes, non-zero size và max artifact size;
   - upload cùng path `report.pdf`;
   - persist hashes/sizes/status `completed`;
   - emit completed event.
6. Failure flow:
   - close browser trong `finally`;
   - sanitize error trước persist;
   - để graphile retry transient errors;
   - lần cuối chuyển `failed`, emit failure event;
   - không để partial S3 object được coi là completed.
7. Docker/hosting:
   - update `infra/docker/server.Dockerfile` runtime packages;
   - xác nhận ECS task memory/headroom;
   - health check không launch browser;
   - document scaling/concurrency trong `docs/hosting/` nếu cần.
8. Integration test dùng Chromium thật nhưng tách khỏi unit suite nếu runtime cost cao; CI phải cài browser/system dependency rõ ràng.

**Exit criteria:** worker tạo PDF hợp lệ từ fixture, retry idempotent, server restart không mất job.

## Phase 7 — API, RBAC và download UX

**Status:** implemented 2026-06-21. Tenant-scoped create/status/retry/download routes require
`pmo.data.read`; create validates explicit range against canonical bounds and enqueues async work;
download redirects through five-minute private S3 signature with safe filename. PMO page and
`pmo_generateReport` chat renderer poll with bounded backoff, show counts/progress/failure, expose
PDF download, and allow failed-run retry.

**Mục tiêu:** user xem trạng thái và tải PDF đúng tenant.

1. Thêm routes trong PMO public surface:
   - `POST /api/pmo/v1/reports` tạo report-only run;
   - `GET /api/pmo/v1/reports/:id` lấy status/summary/artifacts;
   - `GET /api/pmo/v1/reports/:id/download?format=pdf|html` trả redirect/presigned GET ngắn hạn hoặc stream.
2. RBAC:
   - create: `pmo.data.read`;
   - download/read: `pmo.data.read`;
   - không cho caller truyền tenant ID;
   - verify `report_runs.tenant_id === session.tenant_id` trước presign.
3. Filename an toàn, ví dụ `pmo-workload-report-2026-01-01-to-2026-01-31.pdf`.
4. Tool output trả `reportRunId`, status, summary, artifact availability; không trả base64 PDF cho model.
5. UI/chat:
   - hiển thị progress `queued/computing/rendering`;
   - poll/query invalidate có backoff và terminal stop;
   - completed card hiển thị counts red/yellow/idle/overbook;
   - nút download PDF;
   - failed card có retry action nếu RBAC cho phép.
6. HITL date range:
   - explicit user range dùng trực tiếp sau validation;
   - upload range chỉ prefill suggestion;
   - database bounds chỉ prefill suggestion;
   - user phải confirm nếu intent thiếu range;
   - custom range ngoài uploaded file được phép nếu nằm trong canonical bounds.

**Exit criteria:** user ở tenant A không đọc/download run tenant B; chat card tải PDF completed được.

## Phase 8 — Non-rebalance actions và narrative boundary

**Status:** implemented 2026-06-21. Typed `PMO_ACTION_CODES` const with 7 stable codes,
`PMO_ACTION_TEMPLATES` deterministic text for each, `buildFindingSuggestedActions()` generates
primary + annotation-driven secondary actions (`CONFIRM_APPROVED_OT`, `VALIDATE_TRAINING_TIME`),
`suggestedActions` array on Finding type, HTML renderer shows multi-action list with code badges
and template descriptions, agent tool Zod schema validates typed enum, 14 focused unit tests.

**Mục tiêu:** action hữu ích nhưng số liệu vẫn deterministic.

1. Rebalance candidates đã được tính ở Phase 2.5. Phase này chỉ sinh stable non-rebalance action codes, ví dụ:
   - `REVIEW_WITH_LINE_MANAGER`;
   - `CHECK_MISSING_TIMESHEET`;
   - `CONFIRM_APPROVED_OT`;
   - `VALIDATE_TRAINING_TIME`;
   - `REVIEW_RA_TIMESHEET_MISMATCH`.
2. Template text mặc định deterministic, đủ dùng khi LLM unavailable.
3. Nếu thêm LLM narrative:
   - input chỉ là compact verified facts + action codes;
   - output qua schema validation;
   - cấm thêm số không có trong input;
   - narrative failure không làm PDF failure; fallback deterministic text.
4. Không cho LLM đổi severity, issue type, exclusions, metric, summary counts, candidate ordering,
   transfer hours, before/after rates hoặc recommendation confidence.
5. Persist narrative provenance/model metadata nếu được dùng.

**Exit criteria:** tắt LLM vẫn tạo được JSON/HTML/PDF đầy đủ và đúng.

## Phase 9 — Verification, rollout và docs

**Status:** implemented 2026-06-21. N02-N05/N12 parametric boundary tests (30 edge values),
structured pino logging in render-pdf and generate-report, `formulas.md` corrected (ratio-of-sums,
idle yellow boundary, action codes), `analytics-compute-contract.md` expanded with report engine
pipeline/freshness/rule catalog/events, report runbook created, `PMO_REPORT_RULES_DIR` documented
in `.env.example`. Full gates pass: typecheck (27 packages), lint (depcruise+biome+all), 399 unit/integration tests.

**Mục tiêu:** ship an toàn, có đường rollback.

1. Unit tests:
   - rule validation/resolution;
   - every boundary N01-N06/N12;
   - aggregation/no double-count;
   - exclusions/context;
   - severity sort;
   - required reduction, transfer simulation và capacity fit;
   - non-multiple reduction, ví dụ cần giảm 6h với step 4h phải thử 8h rồi validate full-green bounds;
   - equal-weight skill coverage + adjacent-skill mapping;
   - task similarity/recency decay/top-K;
   - hard filter precedence over score;
   - candidate count min 1/default 3/max 5;
   - portfolio target-capacity reservation;
   - action codes;
   - HTML escaping/rendering.
2. Integration tests với real Postgres/testcontainers:
   - canonical DB -> ensure facts -> report run;
   - upload publish -> facts -> report run;
   - stale facts trigger lazy recompute;
   - current facts không recompute;
   - tenant isolation;
   - report persistence/rule snapshot;
   - facts/canonical freshness versions;
   - skill/task-history production data path;
   - recommendation persistence + no-valid/partial-relief cases;
   - worker retry/idempotency;
   - S3 file store bằng test implementation, không DB mocks.
3. Contract tests:
   - agent tool schema;
   - workflow output schema;
   - API response schema;
   - backward adapter cho old report types.
4. PDF tests:
   - magic bytes `%PDF-`;
   - text extraction chứa report title, red/yellow headings và fixture member names;
   - screenshot/golden cho trang đầu và employee table nếu CI ổn định;
   - large fixture để bắt page-break/truncation.
5. E2E:
   - no-upload report thiếu date -> confirm -> PDF;
   - upload -> publish approval -> report range -> PDF;
   - red/yellow sections visible;
   - overbook card shows top 3 candidates mặc định, tối đa 5 khi caller request và đủ valid candidates;
   - idle card does not show source rebalance recommendation;
   - before/after busy rates and matched-skill evidence visible in PDF;
   - download success;
   - cross-tenant ID trả 404/403 theo API convention.
6. Performance/limits:
   - max 26 tuần cho PDF;
   - max 1,000 members hoặc 2,000 findings cho PDF;
   - vượt limit trả actionable validation, không render PDF bị truncate;
   - benchmark 100, 1,000, 5,000 members;
   - record compute/render duration and artifact size.
7. Observability:
   - structured logs với `reportRunId`, tenant ID, status, duration; không log full payload;
   - metrics queued/completed/failed/render duration/PDF bytes;
   - trace spans compute, HTML, Chromium, S3.
8. Docs:
   - cập nhật `docs/architecture.md` nếu implementation shape thay đổi;
   - cập nhật `packages/pmo/docs/analytics-compute-contract.md`;
   - cập nhật `packages/pmo/docs/formulas.md`;
   - thêm report runbook vào `packages/pmo/docs/`;
   - thêm Chromium/env variables vào `.env.example` và hosting docs.
9. Chạy gate đầy đủ:

   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   pnpm test:e2e
   ```

10. Rollout:
    - feature flag PDF generation nếu cần;
    - deploy migration trước code đọc columns mới;
    - canary với một tenant;
    - monitor failure/memory;
    - giữ JSON report usable nếu PDF worker bị disable.

**Exit criteria:** full gates pass; PDF canary thành công; docs và runbook đủ để operator xử lý failure.

## 8. Thứ tự PR khuyến nghị

Mỗi PR nhỏ, independently reviewable:

1. `docs(pmo): lock report rules and contracts`
2. `feat(pmo): add versioned report rule resolver`
3. `refactor(pmo): generate reports from persisted facts`
4. `feat(pmo): add skill and task-history recommendation data contracts`
5. `feat(pmo): add deterministic rebalance recommendation engine`
6. `feat(pmo): add reusable report application service`
7. `feat(pmo): persist report audit and artifact metadata`
8. `feat(pmo): render deterministic report HTML`
9. `feat(pmo): render PDF in graphile worker`
10. `feat(pmo): expose report status and download API`
11. `feat(web): show PMO report progress and PDF download`
12. `test(pmo): add end-to-end report recommendation and PDF coverage`

Không gom migration, analytics rewrite, Chromium, API và UI vào một PR.

## 9. Definition of Done

- Cùng report request tạo cùng severity/counts từ cùng persisted facts + rule snapshot.
- Upload path không report trước publish.
- No-upload path không tạo ingestion session giả.
- Date range luôn explicit hoặc user-confirmed.
- Không query staging/raw Excel trong report engine.
- Không double-count RA nhiều project.
- Facts freshness được chứng minh bằng `factsVersion` + `canonicalDataVersion`.
- Leave/holiday/training/OT xử lý đúng contract và hiện trong evidence.
- Idle/overbook được group `red` rồi `yellow` trong JSON, HTML và PDF.
- Mỗi overbook yellow/red có tối đa configured 1-5 valid candidates, top 3 mặc định, hoặc explicit
  `partial_relief`/`no_valid_rebalance_found`.
- Recommendation có score breakdown, evidence và before/after busy rates.
- Recommendation degraded phải có `recommendationDegraded=true` và machine-readable `dataQualityFlags`.
- Idle member chỉ là target candidate, không là source recommendation.
- Hard constraints luôn thắng ranking; portfolio-selected recommendations không double-book target capacity.
- Recommendation không tự mutate allocations.
- HTML standalone, escaped, deterministic.
- PDF private S3 artifact tải được qua tenant-scoped RBAC.
- Report cũ vẫn giải thích được bằng rule snapshot/hash.
- Worker retry idempotent; failed render không mất JSON report.
- LLM không tính số hoặc đổi classification.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## 10. Quyết định product đã khóa

1. N01 `busyRate >= 1.20` là red.
2. N06 `effortConsumption <= 0.75` là red; yellow bắt đầu `> 0.75`.
3. Partial leave/holiday điều chỉnh denominator. Full leave/holiday hoặc `available_h = 0` bị exclude.
4. Training và approved OT là annotation/supporting context, không exclusion mặc định.
5. Member-level N01 dùng `sum(planned_h) / sum(available_h)`.
6. PDF v1 dùng A4 portrait.
7. PDF v1 không cần logo; header dùng tenant/company name text và audit metadata.
8. PDF v1 tối đa 26 tuần, 1,000 members hoặc 2,000 findings.
9. Skills/task history dùng PMO local projections; report hot path không gọi identity/planner.
10. Ưu tiên full-green recommendation; chỉ trả `partial_relief` khi không có full solution và label rõ.
11. Adjacent-skill taxonomy nằm trong versioned PMO recommendation config; owner PMO/product + tech lead.
12. Candidate count default 3, min 1, max 5.
13. MVP reserve top-1 globally; candidate 2-5 là mutually exclusive alternatives. Global optimizer để v2.

Mọi quyết định trên phải được encode vào JSON/schema/golden tests, không chỉ giữ trong docs/chat.
