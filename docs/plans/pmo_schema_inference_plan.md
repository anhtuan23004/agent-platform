# PMO Schema Inference — Delivery Plan

> Pipeline Gate #1: No downstream calculation runs until schema mapping is confirmed.

---

## Goal

Build a deterministic schema inference pipeline that reads an uploaded PMO workbook (Excel/CSV), detects sheet roles and header rows, profiles columns, maps source columns to the canonical PMO schema, validates completeness, and either auto-accepts (high confidence) or suspends for PMO confirmation. Only frozen mappings pass to normalization.

---

## Canonical Schema Scope

| Table ID | Required Fields | Description |
|---|---|---|
| `resource_allocation` | member_id, project_id, allocation_pct, start_date, end_date | Planned RA records |
| `timesheet` | member_id, work_date, logged_hours | Actual hours logged |
| `leave` | member_id, start_date, end_date, leave_type | Absence records |
| `member_master` | member_id, member_name | People master |
| `project_master` | project_id, project_name | Project master |
| `overbook_idle_config` | (config table — no strict required) | Threshold rules |
| `calendar_weeks` | week_start, week_end | Reference calendar |
| `kpi_norms` | kpi_id, threshold_value | KPI reference |

---

## Pipeline Steps (strict order)

| # | Task | Input | Output | Gate to next |
|---|---|---|---|---|
| 1 | Define canonical schema | Business requirements | `canonical_schema.ts` — tables, fields, types, synonyms, constraints | Schema reviewed by product owner |
| 2 | Define mapping rules | Canonical schema + sample files | Synonym dictionary, value patterns, type inference rules, confidence formula | Rules validated against 3+ sample files |
| 3 | Inspect workbook | Raw .xlsx/.csv file | Sheet inventory: names, row counts, used ranges, candidate header rows | Parser returns structured metadata for all sheets |
| 4 | Detect sheet roles | Sheet inventory + canonical table patterns | Each sheet assigned a `candidate_role` with confidence | All required tables have at least one candidate sheet |
| 5 | Detect header row | Sheet metadata + sample rows | Header row index per sheet (handle note rows at row 1) | Header detection correct on DS05/DS06 shifted-header case |
| 6 | Profile columns | Parsed rows below header | Per-column: inferred type, null rate, unique count, sample values, value pattern | Profile available for every column in every detected sheet |
| 7 | Map columns to canonical fields | Column profiles + synonym dictionary + value patterns | Candidate mapping: source_column → canonical_field + confidence score | Every required field has at least one candidate |
| 8 | Calculate confidence | Individual mappings + cross-sheet consistency | Aggregate confidence per table and per field; classification: auto/review/block | Confidence formula produces consistent results on test fixtures |
| 9 | Validate mapping | Confirmed/proposed mapping | Validation report: missing required fields, type mismatches, range issues, cross-sheet inconsistencies | Validation catches all blocking issues in test suite |
| 10 | Human confirmation flow | Low-confidence or ambiguous mappings | User decision: approve / modify / reject | Workflow suspends and resumes correctly; no re-run of steps 3-8 |
| 11 | Freeze mapping | Confirmed mapping | Immutable `frozen_mapping` artifact passed to normalization | Frozen output serializable and reproducible |
| 12 | Test suite | All above | Pass/fail across happy path + edge cases | All DoD criteria met |

---

## Day-by-Day Delivery Plan

### Day 1: Business Schema Specification (Steps 1-2)

**Objective:** Lock what the agent needs to understand. No code yet.

**Deliverables:**

| Deliverable | Content |
|---|---|
| `canonical-schema.ts` | TypeScript definition: tables, fields, data types, required flags, synonyms, value patterns |
| Required field matrix | Per table: which fields block pipeline if unmapped |
| Business meaning glossary | Each field explained so engineer doesn't mis-map |
| Blocking rules | When pipeline MUST stop vs. when it can warn-and-continue |
| Synonym dictionary | All known header variations per canonical field (Vietnamese + English) |

**Canonical field example:**
```
Resource Allocation (required):
  member_id    — synonyms: Member_ID, employee_id, emp_id, resource_id, user_id
  project_id   — synonyms: Project_ID, proj_id, project_code, project
  allocation_pct — synonyms: Allocation_pct, alloc_%, %, FTE, allocation
  start_date   — synonyms: Start_date, from_date, begin_date
  end_date     — synonyms: End_date, to_date, finish_date

Timesheet (required):
  member_id    — synonyms: Member_ID, employee_id
  work_date    — synonyms: Work_date, date, log_date
  logged_hours — synonyms: Logged_hours, hours, actual_hours, time_spent
```

**Gate:** Product owner signs off that no business field is missing.

---

### Day 2: Workbook Inspection (Steps 3-5)

**Objective:** Agent can read file structure without doing any inference.

**Deliverables:**

| Deliverable | Content |
|---|---|
| Structured parser | ExcelJS-based parser returning `StructuredSheet[]` (not flat text) |
| Sheet inventory | List of sheets with row count, column count, used range |
| Header candidates | Per sheet: which row is likely the header (handle note-at-row-1) |
| Sample rows | First 5 data rows below detected header |
| Warning signals | Blank rows, note rows, merged cells, duplicate headers detected |

**Output format:**
```json
{
  "sheets": [
    {
      "name": "DS05_Project_Master",
      "rowCount": 45,
      "colCount": 8,
      "headerRow": 2,
      "headerRowConfidence": 0.96,
      "headers": ["Project_ID", "Project_name", "Status", "Start_date", ...],
      "sampleRows": [...],
      "warnings": ["Row 1 appears to be a note, not header"]
    }
  ]
}
```

**Special handling rules:**
- DS05_Project_Master, DS06_Member_Master: note at row 1, real header at row 2
- LEGEND & SUMMARY: metadata only, skip from business data
- Answer_Key: exclude from production ingestion

**Gate:** Parser correctly returns structured output for real PMO workbook fixture.

---

### Day 3: Sheet Role + Column Mapping (Steps 4, 6-8)

**Objective:** Determine which sheet is which table, and which column maps to which field.

**Deliverables:**

| Deliverable | Content |
|---|---|
| Sheet role detector | Match sheet names against `sheetNamePatterns` per canonical table |
| Column profiler | Per column: inferred data type, null rate, unique count, value samples, pattern match |
| Column mapper | Score each source column against each canonical field |
| Confidence calculator | Weighted hybrid score per mapping |
| Evidence trail | Explanation of why each mapping was chosen |

**Confidence scoring formula:**

| Signal | Weight | How |
|---|---|---|
| Header similarity | 40% | Levenshtein / exact match against synonym list |
| Value pattern match | 25% | Regex from `valuePattern` tested against sample values |
| Data type compatibility | 15% | Inferred type vs. expected `dataType` |
| Sheet context | 10% | Sheet role already detected → narrow candidate fields |
| Cross-sheet consistency | 10% | Same member_id column name across RA + Timesheet + Leave |

**Output format:**
```json
{
  "table": "resource_allocation",
  "sourceSheet": "DS01_Resource_Allocation",
  "confidence": 0.94,
  "mappings": [
    {
      "sourceColumn": "Member_ID",
      "canonicalField": "member_id",
      "confidence": 0.99,
      "evidence": "exact synonym match + string type + high uniqueness"
    },
    {
      "sourceColumn": "Alloc_%",
      "canonicalField": "allocation_pct",
      "confidence": 0.87,
      "evidence": "synonym match 'alloc_%' + value pattern /^\\d+%?$/ + numeric type"
    }
  ],
  "unmapped": [],
  "ambiguous": []
}
```

**Rule:** LLM does NOT decide mappings. LLM may assist only when a column is genuinely ambiguous (multiple equal-confidence candidates). All other mapping is deterministic.

**Gate:** Mapping tests pass for standard file, shifted-header file, ambiguous-column file.

---

### Day 4: Validation + HITL Policy (Steps 9-10)

**Objective:** Ensure mapping is safe before normalization runs.

**Deliverables:**

| Deliverable | Content |
|---|---|
| Validation engine | Check: required fields present, types compatible, date ranges sane, cross-sheet member_id consistency |
| Confidence policy | Classification rules for auto-accept / needs-review / blocked |
| HITL approval card schema | What the user sees when confirmation is needed |
| Resume payload contract | What data flows back after user decision |
| Frozen mapping output | Immutable artifact for normalization |

**Confidence policy table:**

| Condition | Action |
|---|---|
| All fields ≥ 0.90 confidence | Auto-accept → continue to normalize |
| Any field 0.70–0.89 | Ask PMO to confirm (suspend workflow) |
| Any field < 0.70 | Manual mapping required (suspend) |
| Missing required field | **Block pipeline** — cannot continue |
| Type mismatch on required field | Block or require explicit confirmation |
| Multiple equal-confidence candidates | Ask user to choose |

**Approval card content (what user sees):**
```
┌─────────────────────────────────────────────────────┐
│ Schema Mapping Confirmation Required                 │
│                                                     │
│ Table: Resource Allocation (DS01)                   │
│ Overall confidence: 87%                             │
│                                                     │
│ ⚠️  Needs review:                                    │
│   "Alloc_%" → allocation_pct (87% confidence)       │
│   Reason: synonym partial match, no exact match     │
│                                                     │
│ ✅ Auto-mapped (high confidence):                    │
│   "Member_ID" → member_id (99%)                     │
│   "Project_ID" → project_id (99%)                   │
│   "Start_date" → start_date (98%)                   │
│   "End_date" → end_date (98%)                       │
│                                                     │
│ [Approve]  [Modify]  [Reject]                       │
└─────────────────────────────────────────────────────┘
```

**Resume behavior after decision:**
- **Approve:** workflow resumes → `confirmStep` returns confirmed mapping → `normalizeStep` runs
- **Modify:** user edits mapping → workflow resumes with modified mapping → `normalizeStep` runs
- **Reject:** workflow terminates → ingestion status = `rejected`

**Critical rule:** After approve/modify, the workflow continues forward from the confirm step. Steps 3-8 (detect, profile, map) are NOT re-executed.

**Gate:** Integration test confirms: suspend → decide → resume → normalize, with no backward step execution.

---

### Day 5: Testing + Acceptance (Step 12)

**Objective:** Prove this gate is reliable enough to protect downstream calculations.

**Test matrix:**

| Test Case | Input | Expected Result |
|---|---|---|
| Happy path — standard file | PMO_02_RA_Timesheet_Monitoring.xlsx | Auto-map all sheets, status = confirmed |
| Header at row 2 | DS05/DS06 with note at row 1 | Detect header at row 2 correctly |
| Ambiguous column | Column named "Hours" (could be planned or logged) | Suspend → ask PMO → resume |
| Missing required field | Timesheet missing "Logged_hours" column | Block pipeline, status = failed |
| Percentage format variance | "50%", "50", "0.5" in allocation column | All normalize to same canonical value |
| Project ID not in master | RA references project not in DS05 | Warning (not blocking at inference step) |
| Unknown sheet name but matching columns | Sheet "Data1" with RA-like columns | Infer role from column pattern |
| Duplicate candidate columns | Two columns match "member_id" equally | Ask user to choose |
| Empty sheet | Sheet with no data rows | Skip with warning |
| LEGEND & SUMMARY sheet | Metadata sheet | Excluded from mapping |

**Gate:** All test cases pass. DoD met.

---

## Definition of Done

| Criteria | Condition |
|---|---|
| Canonical schema locked | All tables, fields, types, synonyms defined and versioned |
| Sheet detection works | All required sheets detected from real workbook |
| Header detection works | Including note-at-row-1 edge case |
| Required fields mapped | RA and Timesheet have all required fields mapped |
| Confidence scores present | Every mapping has a numeric confidence |
| Validation report generated | Missing/ambiguous/type-mismatch issues logged |
| HITL behavior works | Low confidence → workflow suspends → user decides → workflow resumes |
| Block behavior works | Missing required field → pipeline stops, no normalization |
| Frozen mapping produced | Output is immutable and usable by normalize step |
| No backward jump | After approve/modify, detect step is not re-executed |

---

## What This Step Produces for Downstream

```json
{
  "schema_status": "confirmed",
  "ingestion_session_id": "uuid",
  "frozen_at": "2026-06-11T10:30:00Z",
  "tables": {
    "resource_allocation": {
      "source_sheet": "DS01_Resource_Allocation",
      "header_row": 1,
      "confidence": 0.94,
      "columns": {
        "member_id": { "source": "Member_ID", "confidence": 0.99 },
        "project_id": { "source": "Project_ID", "confidence": 0.99 },
        "allocation_pct": { "source": "Alloc_%", "confidence": 0.87, "confirmed_by_user": true },
        "start_date": { "source": "Start_date", "confidence": 0.98 },
        "end_date": { "source": "End_date", "confidence": 0.98 }
      }
    },
    "timesheet": {
      "source_sheet": "DS02_Timesheet_Log",
      "header_row": 1,
      "confidence": 0.97,
      "columns": {
        "member_id": { "source": "Member_ID", "confidence": 0.99 },
        "work_date": { "source": "Work_date", "confidence": 0.98 },
        "logged_hours": { "source": "Logged_hours", "confidence": 0.97 },
        "log_category": { "source": "Log_category", "confidence": 0.95 }
      }
    }
  },
  "blocking_issues": [],
  "warnings": ["DS04 'status' column has 12% null rate"]
}
```

Normalization step receives this artifact and transforms raw rows without re-reading structure.

---

## MVP Scope (Hackathon)

**In scope:**

| Item | Why |
|---|---|
| Canonical schema definition | Foundation for everything |
| Structured workbook parser | Agent needs structured metadata, not flat text |
| Sheet role detection | Must know which sheet is RA vs Timesheet |
| Header row detection | Handles note-at-row-1 case |
| Column profiling | Needed for type/pattern evidence |
| Column-to-field mapping + confidence | Core of the gate |
| Validation rules for blocking issues | Pipeline safety |
| HITL suspend/resume flow | The clarification loop |
| Freeze mapping artifact | Handoff to normalization |

**Out of scope (not for POC):**

| Item | Reason |
|---|---|
| Schema learning from historical files | Over-engineering for MVP |
| Vector DB / RAG for schema patterns | Not needed with synonym dictionary |
| Auto-repair source file | Risk, out of scope |
| Support arbitrary Excel formats | Not realistic in 2 weeks |
| Complex drag-and-drop mapping UI | Simple preview + confirm is enough |
| LLM-driven mapping (except tiebreaker) | Deterministic-first principle |

---

## Architecture Alignment

This step uses:
- **Mastra evented workflow** (`createWorkflow` from `@mastra/core/workflows/evented`) — same as `planner.assignBySkill`
- **suspend/resume pattern** with `suspendSchema` + `resumeSchema` — same as `suggestStep` in assign-by-skill
- **Lifecycle hook projection** — workflow_runs + workflow_approvals rows created automatically
- **Existing approval UI** — renders the mapping confirmation card in-thread

This step does NOT use:
- Chat HITL (synthetic workflow — wrong path for multi-step durable workflow)
- Staffing orchestrator (single-step wrapper — wrong granularity)
- Replay-from-step (that's for post-completion retry, not in-flight pause)
- LLM for calculation or mapping logic

---

## Sprint Slice (if needed)

| Sprint | Steps | Deliverable |
|---|---|---|
| Sprint 1 (3 days) | 1-2 + Day 1-2 impl | Canonical schema + structured parser + profiler |
| Sprint 2 (3 days) | 3-5 + Day 3-4 impl | Sheet detection + column mapping + validation + HITL wiring |
| Sprint 3 (2 days) | Day 5 | Test suite + fixture validation + DoD sign-off |

---

## Appendix A: Confidence Scoring Formula

### A.1 Final Field Confidence

```
field_confidence =
  0.35 × header_similarity
+ 0.30 × value_pattern_score
+ 0.15 × data_type_score
+ 0.10 × sheet_context_score
+ 0.10 × cross_sheet_score
```

All signals are normalized to 0–1 before weighting.

---

### A.2 Header Similarity

#### Normalization (applied to both source header and synonyms before comparison)

| Rule | Example |
|---|---|
| Lowercase | `Member ID` → `member id` |
| Replace `_` with space | `member_id` → `member id` |
| Remove special chars | `RA (%)` → `ra` |
| Expand abbreviation (standalone only) | `emp` → `employee`, `hrs` → `hours`, `pct` → `percent` |

**Abbreviation expansion constraint:** Only expand when the token is standalone. `RA_Status` does NOT expand unless sheet context confirms resource allocation. Expansion is context-dependent when sheet role is uncertain.

#### Scoring priority (use `max()` of all methods)

| Method | Score |
|---|---|
| Exact canonical name match | 1.00 |
| Exact synonym match | 0.95 |
| Match after abbreviation expansion | 0.90 |
| Fuzzy match (see table below) | variable |
| Embedding fallback (optional) | `cosine_sim × 0.85` |

#### Fuzzy score mapping

| Fuzzy raw (token_set_ratio / 100) | Header score |
|---|---|
| ≥ 0.93 | 0.90 |
| 0.88 – 0.92 | 0.85 |
| 0.80 – 0.87 | 0.75 |
| 0.65 – 0.79 | 0.55 |
| 0.50 – 0.64 | 0.35 |
| < 0.50 | 0.00 |

#### Final

```
header_similarity = max(exact_or_synonym_score, fuzzy_score, embedding_score)
```

#### Guardrails

- Top 2 canonical candidates gap < 0.10 → mark `needs_review`
- Fuzzy high but value pattern fails → do not auto-accept
- Embedding high but deterministic signals weak → mark `needs_review`

---

### A.3 Value Pattern Score

General formula:

```
value_pattern_score = matched_valid_values / non_empty_values
```

With field-specific sub-formulas:

#### `member_id`
```
0.30 × string_ratio
+ 0.25 × repeat_ratio_score     (1.0 if unique_ratio < 0.8)
+ 0.25 × format_consistency     (stable format like EMP001)
+ 0.20 × member_master_overlap  (if master available)
```

#### `allocation_pct`
```
0.70 × valid_percentage_ratio   (parseable as 0-1.5 after normalization)
+ 0.20 × range_score            (see table below)
+ 0.10 × consistency_score      (single format = 1.0, mixed but normalizable = 0.8)
```

Percentage normalization: `50%` → 0.5, `50` → 0.5 (if most values 0–100), `0.5` → 0.5, `100` → 1.0.

Range score for allocation:
| Condition | Score |
|---|---|
| ≥ 95% values normalize to 0–1.5 | 1.00 |
| ≥ 90% values normalize to 0–2.0 | 0.80 |
| Many negative or extreme values | 0.30 |
| Cannot normalize | 0.00 |

#### `logged_hours`
```
0.60 × numeric_ratio
+ 0.30 × daily_hours_range_ratio   (values between 0–24)
+ 0.10 × decimal_allowed_score     (1.0 if decimals like 0.5, 7.5 are present)
```

For weekly timesheets, range shifts to 0–80.

#### `work_date`, `start_date`, `end_date`
```
0.80 × parseable_date_ratio
+ 0.20 × date_range_reasonableness
```

Date range reasonableness:
| Condition | Score |
|---|---|
| Dates within monitoring period | 1.00 |
| Dates near monitoring period | 0.80 |
| Dates chaotic or far out | 0.40 |
| Cannot parse | 0.00 |

#### `log_category`
```
0.60 × enum_match_ratio     (matches known enum: Project, Internal, Training, Admin, Leave, etc.)
+ 0.25 × low_cardinality_score  (unique_ratio ≤ 0.10 → 1.0, 0.10–0.30 → 0.7, > 0.30 → 0.3)
+ 0.15 × business_keyword_score
```

**Design note:** Adding a new canonical field requires a corresponding value pattern scorer. This is intentional for POC — field set is fixed and small.

---

### A.4 Data Type Score

```
data_type_score = compatible_values / non_empty_values
```

| Compatible ratio | Score |
|---|---|
| ≥ 0.95 | 1.00 |
| 0.85 – 0.94 | 0.80 |
| 0.70 – 0.84 | 0.60 |
| 0.50 – 0.69 | 0.30 |
| < 0.50 | 0.00 |

**Hard rules (override confidence):**

| Field | Block condition |
|---|---|
| `allocation_pct` | Cannot parse as number/percentage |
| `logged_hours` | Cannot parse as number |
| `work_date`, `start_date`, `end_date` | Cannot parse as date |

---

### A.5 Sheet Context Score

#### Sheet role confidence (determines what table a sheet represents)

```
sheet_role_confidence =
  0.45 × sheet_name_score
+ 0.35 × column_set_score
+ 0.20 × row_pattern_score
```

**Sheet name score:** Keyword matching against canonical `sheetNamePatterns`.

**Column set score:**
```
column_set_score = matched_required_signals / expected_required_signals
```

**Row pattern score:** Structural signals (RA = member+project+allocation+dates, Timesheet = many rows per date, Member = unique IDs, etc.)

#### Field context score

```
sheet_context_score = sheet_role_confidence × field_role_compatibility
```

Field-role compatibility matrix:

| Sheet role | Field | Compatibility |
|---|---|---|
| timesheet | logged_hours | 1.00 |
| timesheet | weekly_planned_hours | 0.30 |
| resource_allocation | allocation_pct | 1.00 |
| resource_allocation | logged_hours | 0.30 |
| leave | duration | 1.00 |
| leave | allocation_pct | 0.10 |
| member_master | member_id | 1.00 |
| project_master | project_id | 1.00 |

---

### A.6 Cross-Sheet Score

#### ID overlap (for `member_id`, `project_id`, `pm_id`, `line_manager_id`)

```
overlap_ratio = distinct_values_found_in_master / distinct_non_empty_values
```

| Overlap ratio | Score |
|---|---|
| ≥ 0.95 | 1.00 |
| 0.85 – 0.94 | 0.85 |
| 0.70 – 0.84 | 0.65 |
| 0.50 – 0.69 | 0.40 |
| < 0.50 | 0.10 |
| No master sheet available | 0.50 (neutral) |

#### Relationship consistency (for dates)

```
valid_date_order_ratio = rows_where_start ≤ end / rows_with_both_dates
```

| Ratio | Score |
|---|---|
| ≥ 0.98 | 1.00 |
| 0.90 – 0.97 | 0.80 |
| 0.75 – 0.89 | 0.50 |
| < 0.75 | 0.20 |

#### Default for fields without cross-sheet signal

```
cross_sheet_score = 0.50 (neutral — absence of evidence ≠ contradiction)
```

---

### A.7 Table Confidence

```
table_confidence = weighted_average(confidence of required fields)
```

Required field weights (RA):

| Field | Weight |
|---|---|
| member_id | 0.25 |
| project_id | 0.25 |
| allocation_pct | 0.25 |
| start_date | 0.125 |
| end_date | 0.125 |

Required field weights (Timesheet):

| Field | Weight |
|---|---|
| member_id | 0.30 |
| work_date | 0.25 |
| logged_hours | 0.30 |
| log_category | 0.15 |

Table status rules:
- Any required field missing → `blocked`
- Any required field confidence < 0.70 → `needs_review`
- All required fields ≥ 0.90 → `confirmed`

---

### A.8 Workbook-Level Confidence

```
workbook_confidence = weighted_average(table_confidence per core table)
```

| Table | Weight |
|---|---|
| resource_allocation | 0.30 |
| timesheet | 0.30 |
| member_master | 0.15 |
| project_master | 0.15 |
| leave | 0.10 |

Workbook status:
- RA or Timesheet blocked → `blocked`
- Member or Project blocked → `needs_review` or `blocked` (strictness-dependent)
- Leave missing → `needs_review` (exception checks incomplete)
- Any core table `needs_review` → `needs_review`
- All core tables confirmed → `confirmed`

---

### A.9 Multi-Candidate Tiebreaker

| Condition | Action |
|---|---|
| Winner ≥ 0.90 AND gap with #2 ≥ 0.10 | Auto-accept winner |
| Winner ≥ 0.70 but < 0.90 | `needs_review` |
| Winner < 0.70 | Reject / manual mapping required |
| Gap between top 2 < 0.10 (regardless of absolute score) | `needs_review` — ask user to choose |
| Winner passes confidence but fails hard rule | `blocked` |

**Key rule:** Gap > 0.10 alone is NOT sufficient for auto-accept. Winner must also exceed the absolute 0.90 threshold.

---

### A.10 Decision Policy (final)

| Condition | Status | Action |
|---|---|---|
| ≥ 0.90 | `auto_accept` | Pass through to normalization |
| 0.70 – 0.89 | `needs_review` | Suspend workflow, ask PMO to confirm |
| < 0.70 | `rejected` | Manual mapping required |
| Missing required field | `blocked` | **Stop pipeline** |
| Top 2 gap < 0.10 | `needs_review` | Ask user to choose |
| Type hard rule fail | `blocked` | Stop or manual mapping |
| Range hard rule fail | `needs_review` or `blocked` | Depends on severity |

**Hard rules always override confidence.** Example: header_similarity high + value_pattern passes, but `logged_hours` column has 40% non-numeric text → `blocked`.

---

### A.11 Worked Examples

#### Example 1: `Allocation_pct` → `allocation_pct`

| Signal | Score |
|---|---|
| header_similarity | 1.00 (exact synonym) |
| value_pattern_score | 0.95 (valid percentages, consistent format) |
| data_type_score | 1.00 (all numeric) |
| sheet_context_score | 1.00 (RA sheet, compatible field) |
| cross_sheet_score | 0.80 (no direct cross-check, above neutral) |

```
0.35×1.00 + 0.30×0.95 + 0.15×1.00 + 0.10×1.00 + 0.10×0.80 = 0.965
```
→ **auto_accept**

#### Example 2: `Hours` → `logged_hours` (ambiguous header)

| Signal | Score |
|---|---|
| header_similarity | 0.55 (fuzzy partial match) |
| value_pattern_score | 0.85 (numeric, daily range) |
| data_type_score | 1.00 (all numeric) |
| sheet_context_score | 0.95 (timesheet sheet, compatible field) |
| cross_sheet_score | 0.50 (neutral) |

```
0.35×0.55 + 0.30×0.85 + 0.15×1.00 + 0.10×0.95 + 0.10×0.50 = 0.742
```
→ **needs_review** (header too ambiguous, ask PMO)

#### Example 3: `Start_date` → `work_date` (wrong semantic)

| Signal | Score |
|---|---|
| header_similarity | 0.30 (low — "start_date" ≠ "work_date" synonyms) |
| value_pattern_score | 0.95 (valid dates) |
| data_type_score | 1.00 (date type) |
| sheet_context_score | 0.30 (timesheet sheet but start_date is RA-compatible, not timesheet) |
| cross_sheet_score | 0.50 (neutral) |

```
0.35×0.30 + 0.30×0.95 + 0.15×1.00 + 0.10×0.30 + 0.10×0.50 = 0.620
```
→ **rejected** (type matches but business meaning wrong — header + context both low)

#### Example 4: `Member_ID` → `member_id` (trivial case)

| Signal | Score |
|---|---|
| header_similarity | 1.00 (exact synonym) |
| value_pattern_score | 0.95 (string, consistent format, overlap with master) |
| data_type_score | 1.00 |
| sheet_context_score | 1.00 |
| cross_sheet_score | 0.98 (95%+ IDs found in member master) |

```
0.35×1.00 + 0.30×0.95 + 0.15×1.00 + 0.10×1.00 + 0.10×0.98 = 0.983
```
→ **auto_accept**
