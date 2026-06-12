# PMO Schema Inference — Step-by-Step Implementation Plan

> Each step produces a testable output before the next step begins.
> File A must compile and pass tests before file B is created.

---

## Step 1: Scaffold PMO module

**Command:**
```bash
pnpm gen module
# name: pmo
# tier: feature
# web companion: Y (or N for now — UI comes later)
```

**Files created by generator:**
```
packages/pmo/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── drizzle/
├── src/
│   ├── index.ts
│   ├── register.ts
│   ├── events.ts
│   ├── rbac.ts
│   ├── contracts.ts
│   └── backend/
│       ├── db/schema.ts
│       ├── agent-tools.ts
│       └── agent-specs.ts
└── tests/
```

**Manual edits after generation:**

1. Edit `packages/pmo/drizzle.config.ts` — confirm `schemaFilter: ['pmo']`
2. Edit `packages/pmo/package.json` — add dep `exceljs` and `csv-parse`:
   ```bash
   pnpm --filter @seta/pmo add exceljs csv-parse
   ```

**Verify:**
```bash
pnpm --filter @seta/pmo typecheck
```

**Gate:** Module compiles. No runtime logic yet.

---

## Step 2: Define canonical schema types

**File:** `packages/pmo/src/backend/ingestion/canonical-schema.ts`

**Content:** TypeScript types + constant data:
- `CanonicalField` interface: name, label, dataType, required, synonyms, valuePattern, description
- `CanonicalTable` interface: id, label, sheetNamePatterns, fields, description
- `CanonicalSchema` interface: version, tables[]
- `PMO_CANONICAL_SCHEMA` constant with all 5 core tables:
  - `resource_allocation` (required: member_id, project_id, allocation_pct, start_date, end_date)
  - `timesheet` (required: member_id, work_date, logged_hours)
  - `leave` (required: member_id, start_date, end_date, leave_type)
  - `member_master` (required: member_id, member_name)
  - `project_master` (required: project_id, project_name)
- Helper functions: `getCanonicalTable()`, `getRequiredFields()`, `buildSynonymIndex()`

**Synonyms must include Vietnamese:** `Mã nhân viên`, `Giờ thực tế`, `Tỷ lệ phân bổ`, etc.

**Test file:** `packages/pmo/tests/unit/canonical-schema.test.ts`
- Assert all required fields have ≥ 3 synonyms
- Assert no duplicate synonyms within same field (typo guard)
- Allow shared synonyms across fields — mapper's tiebreaker + sheet context resolves ambiguity (e.g. `"Date"` valid for `work_date`, `start_date`, `end_date`)
- Assert `buildSynonymIndex()` returns complete index
- Assert `getRequiredFields('resource_allocation')` returns 5 fields

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/canonical-schema.test.ts
```

**Gate:** Schema types compile. Tests pass. No DB interaction yet.

---

## Step 3: Structured workbook parser

**File:** `packages/pmo/src/backend/ingestion/parse-workbook.ts`

**Depends on:** Step 2 (imports CanonicalSchema types for return type annotations only)

**Content:**
```ts
interface ParsedColumn {
  index: number;
  name: string;
  sampleValues: string[];  // first 10 non-empty
  nonEmptyCount: number;
  totalRowCount: number;
}

interface ParsedSheet {
  name: string;
  rowCount: number;
  colCount: number;
  headerRow: number;         // 1-indexed
  headers: string[];
  columns: ParsedColumn[];
  rows: Record<string, string>[];            // ALL data rows below header (full parse)
  sampleDataRows: Record<string, string>[];  // first 5 rows (convenience subset)
  warnings: string[];
}

interface WorkbookParseResult {
  sheets: ParsedSheet[];
  excludedSheets: string[];  // LEGEND, SUMMARY, Answer_Key
  parseErrors: string[];
}

export async function parseWorkbook(buffer: Buffer): Promise<WorkbookParseResult>
```

**Implementation logic:**
1. Load buffer via ExcelJS
2. Iterate sheets — skip if name matches exclusion list (`LEGEND`, `SUMMARY`, `Answer_Key`)
3. For each sheet:
   - Detect header using multi-signal scoring on first 10 rows:
     ```
     headerScore(row) =
       0.30 × string_like_ratio      (cells that look like labels, not data)
     + 0.25 × next_row_data_density   (row below has numeric/date values)
     + 0.20 × non_empty_ratio         (most cells filled)
     + 0.15 × unique_cell_ratio       (labels tend to be unique)
     + 0.10 × no_numeric_cells        (headers rarely contain numbers)
     ```
     Pick row with highest score in first 10 rows.
   - Override: if row 1 has ≤ 2 non-empty cells and row 2 scores highest → header = row 2 (DS05/DS06)
   - Note: header detection uses structural signals ONLY — no synonym matching here (avoids circular dependency with column mapping phase)
   - Extract headers from detected header row
   - Parse ALL data rows below header into `rows` array
   - Set `sampleDataRows` = first 5 entries from `rows`
   - Extract columns with sample values
   - Count rows, detect warnings (blank rows, merged cells)

**Test file:** `packages/pmo/tests/unit/parse-workbook.test.ts`

**Test fixtures:** Create `packages/pmo/tests/fixtures/`:
- `simple-ra.xlsx` — 1 sheet, clean header at row 1, 5 data rows
- `shifted-header.xlsx` — header at row 2 (note at row 1)
- `multi-sheet.xlsx` — 3 sheets (RA, Timesheet, Members)

Fixture creation helper (in test file):
```ts
import ExcelJS from 'exceljs';

async function createFixture(sheets: { name: string; rows: string[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

**Test cases:**
- Parse simple RA file → correct headers, 5 data rows, headerRow=1
- Parse shifted-header file → headerRow=2, correct headers
- Parse multi-sheet → 3 ParsedSheet entries
- Excluded sheets (LEGEND, Answer_Key) → in `excludedSheets`, not in `sheets`
- Empty sheet → warning, 0 rows

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/parse-workbook.test.ts
```

**Gate:** Parser returns structured metadata for all test fixtures.

---

## Step 4: Column profiler

**File:** `packages/pmo/src/backend/ingestion/profile-columns.ts`

**Depends on:** Step 3 (`ParsedSheet` type)

**Content:**
```ts
interface ColumnProfile {
  columnName: string;
  inferredType: 'string' | 'number' | 'date' | 'percentage' | 'boolean' | 'mixed';
  nullRate: number;          // 0.0–1.0
  uniqueCount: number;
  uniqueRate: number;        // unique / non-empty
  sampleValues: string[];    // first 5 unique non-empty
  valuePattern: string | null;  // detected regex pattern
  stats: {
    min?: number | string;
    max?: number | string;
    mean?: number;
  };
}

interface SheetProfile {
  sheetName: string;
  headerRow: number;
  columns: ColumnProfile[];
  rowCount: number;
}

export function profileColumns(sheet: ParsedSheet): SheetProfile
```

Note: `sheet.rows` provides full data — no separate `allRows` parameter needed.

**Implementation logic:**
1. For each column (by header name):
   - Collect all values from `sheet.rows`
   - Compute nullRate = empty / total
   - Count unique non-empty values
   - Infer **structural type** by trying parse order: number → date → boolean → string
   - Pick dominant type (≥ 70% of non-empty values parseable)
   - Note: percentage is NOT a structural type — it's a semantic type. `"50%"` parses as number (value 0.5). The value_pattern_scorer (Step 7) handles percentage semantics when canonical field has `dataType: 'percentage'`.
   - Detect value pattern (e.g. `EMP\d{3}`, `\d{4}-\d{2}-\d{2}`, `\d+%`)
   - Compute basic stats for numeric columns

**Test file:** `packages/pmo/tests/unit/profile-columns.test.ts`

**Test cases:**
- Column with all dates → `inferredType: 'date'`
- Column with `50%`, `75%`, `100%` → `inferredType: 'percentage'`
- Column with mix of numbers and text → `inferredType: 'mixed'`
- Column with 30% nulls → `nullRate: 0.3`
- Column with IDs → low nullRate, high uniqueRate
- Column with categories → low uniqueRate, `inferredType: 'string'`

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/profile-columns.test.ts
```

**Gate:** Profiler correctly infers types and stats for all test columns.

---

## Step 5: Sheet role detector

**File:** `packages/pmo/src/backend/ingestion/detect-sheet-role.ts`

**Depends on:** Step 2 (canonical schema `sheetNamePatterns`), Step 4 (SheetProfile)

**Content:**
```ts
interface SheetRoleCandidate {
  candidateRole: string;         // canonical table id
  confidence: number;            // 0–1
  evidence: string[];
}

interface SheetRoleDetection {
  sheetName: string;
  topCandidate: SheetRoleCandidate | null;  // highest confidence, or null if all < 0.30
  otherCandidates: SheetRoleCandidate[];    // remaining candidates sorted desc
}

export function detectSheetRoles(
  sheets: SheetProfile[],
  schema: CanonicalSchema,
): SheetRoleDetection[]
```

Mapper (Step 11) only processes `topCandidate`. If `null` → sheet skipped.

**Implementation logic:**
```
sheet_role_confidence =
  0.45 × sheet_name_score
+ 0.35 × column_set_score
+ 0.20 × row_pattern_score
```

1. **Sheet name score:** Normalize sheet name, match against each table's `sheetNamePatterns`
2. **Column set score:** Count how many required field synonyms appear in the sheet's headers / total required fields
3. **Row pattern score:** Check structural signals (e.g., RA has member+project+date pattern, Timesheet has many rows per date)

**Test file:** `packages/pmo/tests/unit/detect-sheet-role.test.ts`

**Test cases:**
- Sheet named "DS01_Resource_Allocation" with RA columns → `resource_allocation` confidence ≥ 0.90
- Sheet named "Data1" with RA-like columns → `resource_allocation` via column set, lower confidence
- Sheet named "DS02_Timesheet_Log" → `timesheet` high confidence
- Sheet named "Members" with member_id + name columns → `member_master`
- Sheet named "Random" with no matching columns → no role assigned (or very low confidence)

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/detect-sheet-role.test.ts
```

**Gate:** Role detection correct for named sheets AND for unnamed-but-column-matching sheets.

---

## Step 6: Header similarity scorer

**File:** `packages/pmo/src/backend/ingestion/scoring/header-similarity.ts`

**Depends on:** Step 2 (synonym lists from canonical schema)

**Content:**
```ts
export interface HeaderScoreResult {
  score: number;            // 0–1
  method: 'exact' | 'synonym' | 'abbreviation' | 'fuzzy' | 'none';
  matchedSynonym: string | null;
}

export function scoreHeaderSimilarity(
  sourceHeader: string,
  canonicalField: CanonicalField,
): HeaderScoreResult
```

**Implementation logic:**
1. Normalize source header (lowercase, `_` → space, remove special chars)
2. Expand standalone abbreviations: `emp→employee`, `hrs→hours`, `pct→percent`, `ra→resource allocation`
3. Try exact match against canonical field name → 1.00
4. Try exact match against each synonym → 0.95
5. Try match after abbreviation expansion → 0.90
6. Fuzzy match (token set ratio) against each synonym → score per table:
   - ≥ 0.93 → 0.90
   - 0.88–0.92 → 0.85
   - 0.80–0.87 → 0.75
   - 0.65–0.79 → 0.55
   - 0.50–0.64 → 0.35
   - < 0.50 → 0.00
7. Return `max()` of all scores

**Fuzzy matching dependency:** Use simple token overlap ratio (no external lib for POC):
```ts
function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  return (2 * intersection) / (tokensA.size + tokensB.size);
}
```

**Test file:** `packages/pmo/tests/unit/scoring/header-similarity.test.ts`

**Test cases:**
- `"Member_ID"` → member_id field → score 1.00 (exact after normalize)
- `"employee_id"` → member_id field → score 0.95 (synonym match)
- `"Emp_ID"` → member_id field → score 0.90 (abbreviation expansion)
- `"Mã nhân viên"` → member_id field → score 0.95 (Vietnamese synonym)
- `"Hours"` → logged_hours field → score ~0.55 (fuzzy partial)
- `"Start_date"` → work_date field → score ≤ 0.35 (wrong semantic)
- `"Random_Column"` → any field → score 0.00

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/scoring/header-similarity.test.ts
```

**Gate:** Scorer returns expected scores for all test headers including Vietnamese.

---

## Step 7: Value pattern scorer

**File:** `packages/pmo/src/backend/ingestion/scoring/value-pattern.ts`

**Depends on:** Step 4 (ColumnProfile for sample values and stats)

**Content:**
```ts
export interface ValuePatternResult {
  score: number;       // 0–1
  details: string;     // human-readable explanation
}

export function scoreValuePattern(
  profile: ColumnProfile,
  canonicalField: CanonicalField,
  allValues: string[],   // full column values for precise calculation
): ValuePatternResult
```

**Implementation logic:** Field-specific sub-scorers:
- `scoreMemberId(profile, allValues)` — string ratio + format consistency + uniqueness
- `scoreAllocationPct(profile, allValues)` — percentage parse + range + consistency
- `scoreLoggedHours(profile, allValues)` — numeric ratio + daily range + decimal
- `scoreDate(profile, allValues)` — parseable ratio + range reasonableness
- `scoreCategory(profile, allValues)` — enum match + low cardinality + keywords
- `scoreGenericString(profile, allValues)` — fallback for string fields

Dispatcher:
```ts
switch (canonicalField.dataType) {
  case 'percentage': return scoreAllocationPct(profile, allValues);
  case 'number':
    if (canonicalField.name.includes('hours')) return scoreLoggedHours(...);
    return scoreGenericNumber(...);
  case 'date': return scoreDate(...);
  case 'enum': return scoreCategory(...);
  default: return scoreGenericString(...);
}
```

**Test file:** `packages/pmo/tests/unit/scoring/value-pattern.test.ts`

**Test cases:**
- Column with `['50%', '75%', '100%']` → allocation_pct → score ≥ 0.90
- Column with `['50', '75', '100']` (no % symbol) → allocation_pct → score ≥ 0.80 (normalizable)
- Column with `['8', '7.5', '4', '6']` → logged_hours → score ≥ 0.85
- Column with `['2026-06-01', '2026-06-02']` → date field → score ≥ 0.90
- Column with `['Project', 'Internal', 'Training']` → log_category → score ≥ 0.85
- Column with `['abc', 'def', '123']` → allocation_pct → score ≤ 0.30

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/scoring/value-pattern.test.ts
```

**Gate:** Each field-specific scorer returns correct scores for valid and invalid data.

---

## Step 8: Data type scorer

**File:** `packages/pmo/src/backend/ingestion/scoring/data-type.ts`

**Depends on:** Step 4 (ColumnProfile.inferredType)

**Content:**
```ts
export function scoreDataType(
  profile: ColumnProfile,
  canonicalField: CanonicalField,
  allValues: string[],
): number
```

**Implementation logic:**
- Parse each value as the canonical field's expected type
- `data_type_score = compatible_values / non_empty_values`
- Map ratio to score: ≥0.95→1.00, 0.85–0.94→0.80, 0.70–0.84→0.60, 0.50–0.69→0.30, <0.50→0.00
- Hard rules: if field is required AND ratio < 0.50 → flag as `blocked`

**Test file:** `packages/pmo/tests/unit/scoring/data-type.test.ts`

**Test cases:**
- All numeric column → number field → 1.00
- 90% parseable dates → date field → 0.80
- Mixed text/number column → number field → 0.30 or 0.60 depending on ratio
- Boolean-like column (`yes/no`) → boolean field → 1.00

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/scoring/data-type.test.ts
```

**Gate:** Type scorer returns correct score bands.

---

## Step 9: Sheet context scorer

**File:** `packages/pmo/src/backend/ingestion/scoring/sheet-context.ts`

**Depends on:** Step 5 (SheetRoleCandidate — sheet role confidence)

**Content:**
```ts
export function scoreSheetContext(
  sheetRole: SheetRoleCandidate,
  canonicalField: CanonicalField,
): number
```

**Implementation:** `sheet_role_confidence × field_role_compatibility` using the compatibility matrix from the scoring formula appendix.

**Test file:** `packages/pmo/tests/unit/scoring/sheet-context.test.ts`

**Test cases:**
- Timesheet sheet + `logged_hours` → high (≈ 0.95)
- Timesheet sheet + `allocation_pct` → low (≈ 0.28)
- RA sheet + `allocation_pct` → high (≈ 0.95)
- Unknown sheet role + any field → moderate (≈ 0.50)

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/scoring/sheet-context.test.ts
```

**Gate:** Context scorer penalizes cross-role field assignments.

---

## Step 10: Cross-sheet scorer

**File:** `packages/pmo/src/backend/ingestion/scoring/cross-sheet.ts`

**Depends on:** Step 4 (profiles from multiple sheets for ID overlap)

**Content:**
```ts
export function scoreCrossSheet(
  columnValues: string[],
  canonicalField: CanonicalField,
  masterValues: string[] | null,  // values from master sheet, if available
): number
```

**Implementation:**
- For ID fields (member_id, project_id): compute `overlap_ratio` against master values
- For date fields: compute `valid_date_order_ratio`
- For fields without cross-sheet signal: return 0.50 (neutral)

**Test file:** `packages/pmo/tests/unit/scoring/cross-sheet.test.ts`

**Test cases:**
- RA member_id with 95% overlap to member master → 1.00
- RA member_id with 50% overlap → 0.40
- No master sheet available → 0.50 (neutral)
- Date column where start ≤ end 98% of time → 1.00

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/scoring/cross-sheet.test.ts
```

**Gate:** Cross-sheet scorer correct for overlap and neutral cases.

---

## Step 11: Column mapper (compose all scorers)

**File:** `packages/pmo/src/backend/ingestion/map-columns.ts`

**Depends on:** Steps 6, 7, 8, 9, 10 (all scorers)

**Content:**
```ts
interface ColumnMapping {
  sourceColumn: string;
  canonicalField: string;
  confidence: number;
  evidence: string;
  status: 'auto_accept' | 'needs_review' | 'blocked';
  scoringBreakdown: {
    headerSimilarity: number;
    valuePattern: number;
    dataType: number;
    sheetContext: number;
    crossSheet: number;
  };
}

interface TableMapping {
  tableId: string;
  sourceSheet: string;
  headerRow: number;
  tableConfidence: number;
  mappings: ColumnMapping[];
  unmappedRequired: string[];   // required fields with no candidate
  ambiguous: string[];          // fields with top-2 gap < 0.10
}

export function mapColumns(
  sheetProfile: SheetProfile,
  sheetRole: SheetRoleCandidate,
  allSheetProfiles: SheetProfile[],  // for cross-sheet scoring
  schema: CanonicalSchema,
): TableMapping
```

**Implementation logic:**
1. For each canonical field in the detected table:
   - Score every source column using all 5 scorers
   - Apply weighted formula: `0.35×header + 0.30×value + 0.15×type + 0.10×context + 0.10×cross`
   - Rank candidates
2. **Global one-to-one assignment pass** (prevents one source column mapping to multiple fields):
   - Collect all (field, sourceColumn, confidence) triples
   - Sort descending by confidence
   - Greedy assign: highest confidence pair first, remove assigned source column from remaining candidates
   - If conflict: keep higher confidence, mark loser as `ambiguous` or find next-best candidate
3. Apply tiebreaker rules:
   - Winner ≥ 0.90 AND gap ≥ 0.10 → `auto_accept`
   - Winner 0.70–0.89 → `needs_review`
   - Winner < 0.70 → mark as rejected
   - Gap < 0.10 → `needs_review`
4. Apply hard rules (type fails → `blocked`)
5. Check unmapped required fields → add to `unmappedRequired`
6. Compute `tableConfidence` as weighted average of required field confidences

**Test file:** `packages/pmo/tests/unit/map-columns.test.ts`

**Test cases:**
- Standard RA sheet with obvious headers → all mapped, all `auto_accept`, tableConfidence ≥ 0.90
- Sheet with ambiguous "Hours" column → `needs_review` on that field
- Sheet missing "logged_hours" column entirely → in `unmappedRequired`, status implications
- Sheet with two columns both matching "member_id" → `ambiguous` list populated
- Vietnamese headers fully covered by synonym list → all `auto_accept`

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/map-columns.test.ts
```

**Gate:** Mapper correctly classifies auto/review/block for all test scenarios.

---

## Step 12: Mapping validator

**File:** `packages/pmo/src/backend/ingestion/validate-mapping.ts`

**Depends on:** Step 11 (TableMapping output)

**Content:**
```ts
interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  tableId: string;
  field: string | null;
  code: string;     // e.g. 'MISSING_REQUIRED', 'TYPE_MISMATCH', 'LOW_CONFIDENCE'
  message: string;
}

interface MappingValidationResult {
  status: 'confirmed' | 'needs_review' | 'blocked';
  issues: ValidationIssue[];
  workbookConfidence: number;
}

export function validateMapping(
  tableMappings: TableMapping[],
): MappingValidationResult
```

**Implementation logic:**
1. For each table:
   - If any required field in `unmappedRequired` → error `MISSING_REQUIRED` → overall `blocked`
   - If any field `blocked` → error → overall `blocked`
   - If any field `needs_review` → warning → overall `needs_review`
2. Compute workbook confidence (weighted average of table confidences)
3. Apply workbook-level policy:
   - RA or Timesheet blocked → `blocked`
   - Any core table needs_review → `needs_review`
   - All confirmed → `confirmed`

**Test file:** `packages/pmo/tests/unit/validate-mapping.test.ts`

**Test cases:**
- All tables high confidence → `confirmed`
- RA missing allocation_pct → `blocked`
- Timesheet has one ambiguous column → `needs_review`
- Member master missing but RA + Timesheet fine → `needs_review` (degraded cross-check)

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/validate-mapping.test.ts
```

**Gate:** Validator correctly blocks, reviews, or confirms based on issues.

---

## Step 13: Top-level orchestration function (pre-workflow)

**File:** `packages/pmo/src/backend/ingestion/detect-schema.ts`

**Depends on:** Steps 3, 4, 5, 11, 12 (all previous components)

**Content:**
```ts
interface SchemaDetectionResult {
  tables: TableMapping[];
  validation: MappingValidationResult;
  workbookMeta: {
    sheetCount: number;
    excludedSheets: string[];
    totalRows: number;
  };
}

export async function detectSchema(fileBuffer: Buffer): Promise<SchemaDetectionResult>
```

**Implementation:** Orchestrates the pipeline:
1. `parseWorkbook(buffer)` → sheets (with full `rows`)
2. For each sheet: `profileColumns(sheet)` → profiles
3. `detectSheetRoles(profiles, schema)` → role detections (per-sheet with topCandidate)
4. For each sheet with `topCandidate != null`: `mapColumns(profile, role, allProfiles, schema)` → mappings
5. `validateMapping(allMappings)` → validation result
6. Return complete result

**Test file:** `packages/pmo/tests/integration/detect-schema.test.ts`

**Test cases (integration — uses full XLSX fixtures):**
- Happy path: multi-sheet XLSX with standard headers → all confirmed
- Shifted header: DS05-style note at row 1 → correctly detects header at row 2
- Ambiguous column: "Hours" in timesheet → needs_review
- Missing required: no member_id equivalent → blocked
- Vietnamese headers: full Vietnamese file → all mapped correctly

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/integration/detect-schema.test.ts
```

**Gate:** Full pipeline produces correct end-to-end result for real-world-like fixtures.

---

## Step 14: DB schema — canonical PMO tables + ingestion state

**File:** Edit `packages/pmo/src/backend/db/schema.ts`

**Depends on:** Step 13 (we now know what data to persist)

**Content:** Add ALL tables — both canonical target tables and ingestion metadata:
```ts
export const pmo = pgSchema('pmo');

// ── Ingestion metadata ──────────────────────────────────────────────────────

export const ingestionSessions = pmo.table('ingestion_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  status: text('status').notNull().default('uploaded'),
    // uploaded | profiling | awaiting_confirmation | confirmed | normalizing | staging_normalized | awaiting_publish_review | published | failed | rejected | superseded
  source_file_key: text('source_file_key').notNull(),
  source_file_name: text('source_file_name').notNull(),
  mime_type: text('mime_type').notNull(),
  detected_schema: jsonb('detected_schema'),       // SchemaDetectionResult
  confirmed_mapping: jsonb('confirmed_mapping'),    // frozen mapping after user confirm
  workbook_confidence: real('workbook_confidence'),
  created_by: uuid('created_by').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
  finished_at: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('ingestion_sessions_tenant_status').on(t.tenant_id, t.status),
]);

// ── Canonical target tables (normalization writes here) ─────────────────────

export const resourceAllocations = pmo.table('resource_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ingestion_session_id: uuid('ingestion_session_id').notNull(),
  member_id: text('member_id').notNull(),
  member_name: text('member_name'),
  project_id: text('project_id').notNull(),
  project_name: text('project_name'),
  allocation_pct: real('allocation_pct').notNull(),  // normalized 0.0–1.0+
  hours_planned: real('hours_planned'),
  start_date: timestamp('start_date', { withTimezone: true }).notNull(),
  end_date: timestamp('end_date', { withTimezone: true }).notNull(),
  role: text('role'),
  source_row: integer('source_row'),  // original row number in source sheet
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('ra_tenant_session').on(t.tenant_id, t.ingestion_session_id),
  index('ra_member_project').on(t.tenant_id, t.member_id, t.project_id),
]);

export const timesheets = pmo.table('timesheets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ingestion_session_id: uuid('ingestion_session_id').notNull(),
  member_id: text('member_id').notNull(),
  project_id: text('project_id'),
  work_date: timestamp('work_date', { withTimezone: true }).notNull(),
  logged_hours: real('logged_hours').notNull(),
  log_category: text('log_category'),
  description: text('description'),
  source_row: integer('source_row'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('ts_tenant_session').on(t.tenant_id, t.ingestion_session_id),
  index('ts_member_date').on(t.tenant_id, t.member_id, t.work_date),
]);

export const leaveRecords = pmo.table('leave_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ingestion_session_id: uuid('ingestion_session_id').notNull(),
  member_id: text('member_id').notNull(),
  start_date: timestamp('start_date', { withTimezone: true }).notNull(),
  end_date: timestamp('end_date', { withTimezone: true }).notNull(),
  leave_type: text('leave_type').notNull(),
  status: text('status'),
  source_row: integer('source_row'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('leave_tenant_session').on(t.tenant_id, t.ingestion_session_id),
]);

export const memberMaster = pmo.table('member_master', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ingestion_session_id: uuid('ingestion_session_id').notNull(),
  member_id: text('member_id').notNull(),
  member_name: text('member_name').notNull(),
  email: text('email'),
  std_hours_week: real('std_hours_week'),
  employment_status: text('employment_status'),
  department: text('department'),
  role: text('role'),
  source_row: integer('source_row'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('member_tenant_session').on(t.tenant_id, t.ingestion_session_id),
]);

export const projectMaster = pmo.table('project_master', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  ingestion_session_id: uuid('ingestion_session_id').notNull(),
  project_id: text('project_id').notNull(),
  project_name: text('project_name').notNull(),
  status: text('status'),
  start_date: timestamp('start_date', { withTimezone: true }),
  end_date: timestamp('end_date', { withTimezone: true }),
  owner: text('owner'),
  source_row: integer('source_row'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('proj_tenant_session').on(t.tenant_id, t.ingestion_session_id),
]);
```

**Run:**
```bash
pnpm --filter @seta/pmo db:generate
pnpm db:migrate
```

**Verify:**
```bash
docker exec seta-ap-postgres-dev psql -U seta -d seta -c '\dt pmo.*'
```

**Gate:** Migration succeeds. Table exists.

---

## Step 15: Ingestion session domain (state machine)

**File:** `packages/pmo/src/backend/domain/ingestion-session.ts`

**Depends on:** Step 14 (DB table)

**Content:**
```ts
const VALID_TRANSITIONS: Record<string, string[]> = {
  uploaded: ['profiling'],
  profiling: ['awaiting_confirmation', 'confirmed', 'failed'],
  awaiting_confirmation: ['confirmed', 'rejected'],
  confirmed: ['normalizing'],
  normalizing: ['staging_normalized', 'failed'],
  staging_normalized: ['awaiting_publish_review', 'published'],  // skip review if no conflicts
  awaiting_publish_review: ['published', 'rejected'],            // dedup/merge review gate
  published: ['superseded'],   // marked when a newer session replaces this one
  superseded: [],  // terminal — data retained for audit but not queried by tools
  failed: [],      // terminal
  rejected: [],    // terminal
};

export async function createIngestionSession(opts: { tenantId, userId, fileKey, fileName, mimeType }): Promise<string>
export async function transitionSession(sessionId: string, newStatus: string, data?: Partial<...>): Promise<void>
```

**Implementation:** Enforces valid state transitions. Throws on invalid transition.

**Test file:** `packages/pmo/tests/unit/ingestion-session.test.ts`

**Test cases:**
- Create session → status = `uploaded`
- Transition uploaded → profiling → ok
- Transition uploaded → confirmed → throws (invalid)
- Transition awaiting_confirmation → confirmed → ok
- Transition awaiting_confirmation → rejected → ok
- Transition normalizing → staging_normalized → ok
- Transition staging_normalized → awaiting_publish_review → ok (conflicts detected)
- Transition staging_normalized → published → ok (no conflicts, skip review)
- Transition published → superseded → ok (newer session replaces)
- Transition confirmed → profiling → throws (no backward)
- Transition superseded → anything → throws (terminal)

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/ingestion-session.test.ts
```

**Gate:** State machine enforces all valid/invalid transitions.

---

## Step 16: Storage abstraction + normalization transformer

**File:** `packages/pmo/src/backend/ingestion/file-store.ts`

**Depends on:** Step 1 (module exists)

**Content:**
```ts
/**
 * Dependency boundary for file access. Injected by platform at runtime.
 * Tests provide an in-memory implementation.
 */
export interface PmoFileStore {
  getBuffer(fileKey: string): Promise<Buffer>;
}
```

This keeps S3 coupling out of domain logic and makes workflow steps testable with in-memory buffers.

**File:** `packages/pmo/src/backend/ingestion/normalize-rows.ts`

**Depends on:** Step 3 (ParsedSheet.rows), Step 11 (TableMapping)

**Content:**
```ts
interface NormalizedRow {
  tableId: string;
  sourceRow: number;
  values: Record<string, unknown>;  // canonical field name → parsed value
  parseErrors: Array<{ field: string; raw: string; error: string }>;
}

interface NormalizationResult {
  tables: Record<string, NormalizedRow[]>;  // tableId → rows
  rowCounts: Record<string, number>;
  errorCount: number;
}

export function normalizeRows(
  parsedSheets: ParsedSheet[],
  confirmedMappings: TableMapping[],
): NormalizationResult
```

**Implementation logic:**
1. For each confirmed table mapping:
   - Find the corresponding ParsedSheet by `sourceSheet` name
   - For each row in `sheet.rows`:
     - Apply column mapping (source column → canonical field)
     - Parse/convert value to canonical type (string→date, string→number, percentage normalization)
     - If parse fails: record in `parseErrors`, continue (partial normalization)
2. Return all transformed rows grouped by table

**Test file:** `packages/pmo/tests/unit/normalize-rows.test.ts`

**Test cases:**
- Standard RA rows → correct date parsing, percentage normalization (50% → 0.5)
- Timesheet rows → correct hours + date parsing
- Mixed percentage formats (`50%`, `50`, `0.5`) → all normalize to 0.5
- Unparseable value → recorded in parseErrors, row still emitted with null for that field
- Empty row → skipped

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/unit/normalize-rows.test.ts
```

**Gate:** Transformer produces correct canonical rows for all formats. Pure function, no DB, no workflow.

---

## Step 16b: Dedup/merge strategy (placeholder — awaiting business decision)

> **Status:** Design pending. Schema inference flow is independent of this decision.

After normalization produces canonical rows, the system must decide how to handle overlap with existing data. This step runs between `staging_normalized` and `published`.

**Open questions (need PM/PMO input):**
1. Is each upload a **full snapshot** (replace all) or **incremental** (merge with existing)?
2. Rows in DB but not in new file — keep or soft-delete?
3. Conflicting values for same natural key — new wins, or ask user?

**Candidate strategies:**

| Strategy | When to use | Complexity |
|----------|------------|------------|
| **Session Replace** | File is always full export | Low — mark old session `superseded`, new session becomes active |
| **Row Upsert** | File is incremental update | Medium — UNIQUE on natural key, ON CONFLICT UPDATE |
| **Merge + Review** | Mixed/unclear | High — detect conflicts, present diff to user at `awaiting_publish_review` |

**Natural keys (if upsert chosen):**
- `resource_allocations`: `(tenant_id, member_id, project_id, start_date, end_date)`
- `timesheets`: `(tenant_id, member_id, work_date, project_id)`
- `leave_records`: `(tenant_id, member_id, start_date, end_date, leave_type)`
- `member_master`: `(tenant_id, member_id)`
- `project_master`: `(tenant_id, project_id)`

**For hackathon MVP:** Default to Session Replace. Mark previous published session as `superseded`. Chat tools query only non-superseded sessions.

**Gate:** No implementation yet. Decision recorded. Schema inference proceeds independently.

---

## Step 17: Workflow schemas (Zod)

**File:** `packages/pmo/src/backend/workflows/ingest-data/schemas.ts`

**Depends on:** Step 13 (SchemaDetectionResult type), Step 11 (TableMapping type)

**Content:**
```ts
import { z } from 'zod';

// ── Typed schemas for workflow boundaries ──────────────────────────────────

const ColumnMappingSchema = z.object({
  sourceColumn: z.string(),
  canonicalField: z.string(),
  confidence: z.number(),
  status: z.enum(['auto_accept', 'needs_review', 'blocked']),
});

const TableMappingSchema = z.object({
  tableId: z.string(),
  sourceSheet: z.string(),
  headerRow: z.number(),
  tableConfidence: z.number(),
  mappings: z.array(ColumnMappingSchema),
  unmappedRequired: z.array(z.string()),
  ambiguous: z.array(z.string()),
});

const ValidationIssueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  tableId: z.string(),
  field: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});

export const DetectOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  tableMappings: z.array(TableMappingSchema),
  validationStatus: z.enum(['confirmed', 'needs_review', 'blocked']),
  workbookConfidence: z.number(),
});

// What the approval card shows to the user
export const MappingCardSchema = z.object({
  meta: z.object({ toolId: z.literal('pmo_confirmMapping') }),
  ingestionSessionId: z.string().uuid(),
  proposedMappings: z.array(TableMappingSchema),
  issues: z.array(ValidationIssueSchema),
  workbookConfidence: z.number(),
  allowApprove: z.boolean(),  // false when status is 'blocked' (missing required fields)
});

// What the user sends back
export const MappingDecisionSchema = z.object({
  decision: z.enum(['approve', 'modify', 'reject']),
  modifiedMappings: z.array(TableMappingSchema).optional(),  // only if decision = 'modify'
  note: z.string().optional(),
});

export const ConfirmOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  confirmedMappings: z.array(TableMappingSchema),
});

export const NormalizeOutputSchema = z.object({
  ingestionSessionId: z.string().uuid(),
  rowsWritten: z.record(z.string(), z.number()),  // { resource_allocation: 120, timesheet: 500 }
  status: z.enum(['success', 'partial', 'failed']),
});
```

**No tests needed** — these are type declarations. They'll be validated by Step 18.

**Verify:**
```bash
pnpm --filter @seta/pmo typecheck
```

**Gate:** Schemas compile without type errors.

---

## Step 18: Evented workflow spec (suspend/resume)

**File:** `packages/pmo/src/backend/workflows/ingest-data/spec.ts`

**Depends on:** Step 13 (detectSchema), Step 15 (transitionSession), Step 16 (file-store + normalize-rows), Step 17 (schemas)

**Content:**
```ts
import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import type { PmoFileStore } from '../../ingestion/file-store.ts';
import { IngestInputSchema, DetectOutputSchema, ConfirmOutputSchema,
         NormalizeOutputSchema, MappingCardSchema, MappingDecisionSchema } from './schemas.ts';

const detectStep = createStep({
  id: 'pmo.ingest.detect',
  inputSchema: IngestInputSchema,
  outputSchema: DetectOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore = requestContext.get('pmoFileStore') as PmoFileStore;
    // 1. Fetch file: fileStore.getBuffer(inputData.fileKey)
    // 2. parseWorkbook → detectSchema
    // 3. transitionSession to 'profiling' then 'awaiting_confirmation' or 'confirmed'
    // 4. Persist detected_schema to DB
    // 5. Return detection result
  },
});

const confirmStep = createStep({
  id: 'pmo.ingest.confirm',
  inputSchema: DetectOutputSchema,
  outputSchema: ConfirmOutputSchema,
  suspendSchema: MappingCardSchema,
  resumeSchema: MappingDecisionSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      if (inputData.validationStatus === 'confirmed') {
        // High confidence — auto pass
        return { ingestionSessionId: inputData.ingestionSessionId, confirmedMappings: inputData.tableMappings };
      }
      // Build card — blocked status gets allowApprove=false
      const allowApprove = inputData.validationStatus !== 'blocked';
      return suspend({ meta: { toolId: 'pmo_confirmMapping' }, allowApprove, ...buildCard(inputData) });
    }
    // User responded
    if (resumeData.decision === 'reject') throw new Error('rejected_by_user');
    if (resumeData.decision === 'approve' && inputData.validationStatus === 'blocked') {
      // Safety: cannot approve a blocked mapping (UI should not show button, but guard server-side)
      throw new Error('cannot_approve_blocked_mapping');
    }
    const mappings = resumeData.decision === 'modify'
      ? resumeData.modifiedMappings!
      : inputData.tableMappings;
    // transitionSession → confirmed
    return { ingestionSessionId: inputData.ingestionSessionId, confirmedMappings: mappings };
  },
});

const normalizeStep = createStep({
  id: 'pmo.ingest.normalize',
  inputSchema: ConfirmOutputSchema,
  outputSchema: NormalizeOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore = requestContext.get('pmoFileStore') as PmoFileStore;
    // 1. Fetch file via fileStore
    // 2. parseWorkbook again (only need rows this time)
    // 3. Call normalizeRows(parsedSheets, inputData.confirmedMappings)
    // 4. Write NormalizedRows to canonical DB tables (resource_allocations, timesheets, etc.)
    // 5. transitionSession → published
    // 6. Return row counts
  },
});

export const ingestDataWorkflow = createWorkflow({
  id: 'pmo.ingestData',
  inputSchema: IngestInputSchema,
  outputSchema: NormalizeOutputSchema,
  retryConfig: { attempts: 2, delay: 1000 },
})
  .then(detectStep)
  .then(confirmStep)
  .then(normalizeStep)
  .commit();

export const ingestDataWorkflowSpec: WorkflowSpec = {
  domain: 'pmo',
  id: 'ingestData',
  description: 'Ingests PMO workbook: detect schema, confirm mapping (HITL if needed), normalize into canonical tables.',
  inputSchema: IngestInputSchema,
  outputSchema: NormalizeOutputSchema,
  workflow: ingestDataWorkflow,
  hitlSteps: ['pmo.ingest.confirm'],
};
```

**Key behaviors:**
- `confirmed` → auto-continues, no suspend
- `needs_review` → suspends with [Approve] [Modify] [Reject]
- `blocked` → suspends with [Modify] [Reject] only (`allowApprove: false`)
- Approve on blocked → server-side guard throws (defense in depth)
- File access via injected `PmoFileStore` (testable with in-memory impl)

**Test file:** `packages/pmo/tests/integration/workflow-ingest.test.ts`

**Test cases:**
- High confidence file → workflow runs all 3 steps without suspend
- Low confidence file → suspends at confirm step → resume with approve → normalize runs
- Low confidence file → resume with modify → normalize uses modified mapping
- Low confidence file → resume with reject → workflow fails/terminates
- **Blocked file** → suspends with `allowApprove: false` → resume with approve → throws `cannot_approve_blocked_mapping`
- **Blocked file** → resume with modify (user fixes mapping) → normalize runs
- **Critical test:** After resume, detect step is NOT re-executed (check call count)
- **Storage test:** Workflow receives `PmoFileStore` via requestContext, not hardcoded S3

**Verify:**
```bash
pnpm --filter @seta/pmo test -- tests/integration/workflow-ingest.test.ts
```

**Gate:** Workflow suspend/resume works. No backward step execution after confirm.

---

## Step 19: Register workflow contribution

**File:** Edit `packages/pmo/src/backend/workflows/index.ts` (created by generator, currently empty)

**Depends on:** Step 18 (workflow spec)

**Content:**
```ts
import type { WorkflowContribution } from '@seta/agent-sdk';
import { ingestDataWorkflowSpec } from './ingest-data/spec.ts';

export const pmoWorkflows: WorkflowContribution[] = [ingestDataWorkflowSpec];
```

**File:** Edit `packages/pmo/src/register.ts`

**Add:**
```ts
import { pmoWorkflows } from './backend/workflows/index.ts';

reg.module({
  name: 'pmo',
  schema,
  migrationsDir: resolve(__dirname, '../drizzle/migrations'),
  events: PMO_EVENTS,
  rbac: pmoRbac,
  workflows: pmoWorkflows,
});
```

**Verify:**
```bash
pnpm --filter @seta/pmo typecheck
```

**Gate:** Module registers workflow contribution. Type-safe.

---

## Step 20: Events and RBAC declarations

**File:** Edit `packages/pmo/src/events.ts`

**Content:**
```ts
import { z } from 'zod';

export const PMO_EVENTS = {
  'pmo.ingestion.schema_detected': z.object({
    ingestion_session_id: z.string().uuid(),
    workbook_confidence: z.number(),
    table_count: z.number(),
  }),
  'pmo.ingestion.mapping_confirmed': z.object({
    ingestion_session_id: z.string().uuid(),
    confirmed_by: z.string().uuid(),
  }),
  'pmo.ingestion.normalization_complete': z.object({
    ingestion_session_id: z.string().uuid(),
    rows_written: z.record(z.string(), z.number()),
  }),
  'pmo.ingestion.failed': z.object({
    ingestion_session_id: z.string().uuid(),
    reason: z.string(),
  }),
} as const;
```

**File:** Edit `packages/pmo/src/rbac.ts`

**Content:**
```ts
import { toManifest, type Statement } from '@seta/shared-rbac';

export const pmoStatement = {
  'pmo.ingestion': ['upload', 'confirm', 'read'],
  'pmo.data': ['read'],
} as const satisfies Statement;

const roleStatements = {
  'pmo.viewer': { 'pmo.data': ['read'], 'pmo.ingestion': ['read'] },
  'pmo.operator': { 'pmo.ingestion': ['upload', 'confirm', 'read'], 'pmo.data': ['read'] },
} as const satisfies Record<string, Statement>;

export const pmoRbac = toManifest('pmo', pmoStatement, roleStatements, {
  'pmo.viewer': 'Read-only access to PMO data and ingestion status',
  'pmo.operator': 'Can upload files, confirm mappings, and read data',
});
```

**Verify:**
```bash
pnpm --filter @seta/pmo typecheck
```

**Gate:** Events and RBAC compile. Module registration succeeds with all contributions.

---

## Step 21: Wire PMO module into server boot

**File:** Edit `apps/server/src/index.ts` — add import and registration call:
```ts
import { registerPmoContributions } from '@seta/pmo/register';
// ... inside boot function:
registerPmoContributions(registry);
```

**File:** Ensure `apps/server/package.json` has `@seta/pmo` in dependencies:
```bash
pnpm --filter @seta/server add @seta/pmo --workspace
```

**Verify:**
```bash
pnpm --filter @seta/pmo typecheck
pnpm lint
pnpm depcruise
```

**Gate:** Full workspace compiles. No cross-module violations. PMO workflow discoverable at boot.

---

## Step 22: Full integration test with real-ish fixture

**File:** `packages/pmo/tests/integration/full-pipeline.test.ts`

**Depends on:** All steps above

**Fixtures:** Create a multi-sheet XLSX in test:
```ts
// Sheets: DS01_Resource_Allocation, DS02_Timesheet_Log, DS06_Member_Master (with note at row 1)
// DS01 headers: Member_ID, Project_ID, Allocation_pct, Start_date, End_date
// DS02 headers: Member_ID, Work_date, Logged_hours, Log_category
// DS06 row 1: "Note: this is the member master list"
// DS06 row 2 (header): Member_ID, Member_name, Email, Department
```

**Test cases:**
1. **Happy path:** Standard file → detectSchema → all confirmed → workflow passes without suspend
2. **HITL path:** Rename "Logged_hours" to "Hours" → detect → needs_review → suspend → user approves → normalize succeeds
3. **Block path:** Remove Member_ID column from RA → detect → blocked → workflow fails
4. **Reject path:** needs_review → user rejects → workflow terminates, status = rejected
5. **Shifted header:** DS06 with note row → header detected at row 2

**Verify:**
```bash
pnpm --filter @seta/pmo test
```

**Gate:** All tests pass. Pipeline behavior matches spec from `pmo_schema_inference_plan.md`.

---

## Summary: File Creation Order

| # | File | Type | Depends on |
|---|---|---|---|
| 1 | (generator output) | scaffold | — |
| 2 | `src/backend/ingestion/canonical-schema.ts` | logic | scaffold |
| 3 | `src/backend/ingestion/parse-workbook.ts` | logic | types from #2 |
| 4 | `src/backend/ingestion/profile-columns.ts` | logic | types from #3 |
| 5 | `src/backend/ingestion/detect-sheet-role.ts` | logic | #2, #4 |
| 6 | `src/backend/ingestion/scoring/header-similarity.ts` | logic | #2 |
| 7 | `src/backend/ingestion/scoring/value-pattern.ts` | logic | #4 |
| 8 | `src/backend/ingestion/scoring/data-type.ts` | logic | #4 |
| 9 | `src/backend/ingestion/scoring/sheet-context.ts` | logic | #5 |
| 10 | `src/backend/ingestion/scoring/cross-sheet.ts` | logic | #4 |
| 11 | `src/backend/ingestion/map-columns.ts` | compose | #6–#10 |
| 12 | `src/backend/ingestion/validate-mapping.ts` | logic | #11 |
| 13 | `src/backend/ingestion/detect-schema.ts` | orchestrate | #3,#4,#5,#11,#12 |
| 14 | `src/backend/db/schema.ts` | DB | #13 (know what to persist) |
| 15 | `src/backend/domain/ingestion-session.ts` | domain | #14 |
| 16 | `src/backend/ingestion/file-store.ts` + `normalize-rows.ts` | abstraction + transform | #3, #11 |
| 17 | `src/backend/workflows/ingest-data/schemas.ts` | types | #11, #12, #13 |
| 18 | `src/backend/workflows/ingest-data/spec.ts` | workflow | #13, #15, #16, #17 |
| 19 | `src/backend/workflows/index.ts` + `src/register.ts` | wiring | #18 |
| 20 | `src/events.ts` + `src/rbac.ts` | declarations | #19 |
| 21 | `apps/server/src/index.ts` | boot | #19, #20 |
| 22 | `tests/integration/full-pipeline.test.ts` | test | all |

---

## Test Execution Order

Tests are written and run alongside each step:

```bash
# After step 2:
pnpm --filter @seta/pmo test -- tests/unit/canonical-schema.test.ts

# After step 3:
pnpm --filter @seta/pmo test -- tests/unit/parse-workbook.test.ts

# After step 4:
pnpm --filter @seta/pmo test -- tests/unit/profile-columns.test.ts

# After step 5:
pnpm --filter @seta/pmo test -- tests/unit/detect-sheet-role.test.ts

# After steps 6-10 (scorers):
pnpm --filter @seta/pmo test -- tests/unit/scoring/

# After step 11:
pnpm --filter @seta/pmo test -- tests/unit/map-columns.test.ts

# After step 12:
pnpm --filter @seta/pmo test -- tests/unit/validate-mapping.test.ts

# After step 13:
pnpm --filter @seta/pmo test -- tests/integration/detect-schema.test.ts

# After step 15:
pnpm --filter @seta/pmo test -- tests/unit/ingestion-session.test.ts

# After step 16:
pnpm --filter @seta/pmo test -- tests/unit/normalize-rows.test.ts

# After step 18:
pnpm --filter @seta/pmo test -- tests/integration/workflow-ingest.test.ts

# After step 22 (full suite):
pnpm --filter @seta/pmo test
pnpm --filter @seta/pmo typecheck
pnpm lint
pnpm depcruise
```
