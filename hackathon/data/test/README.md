# PMO Eval Workbook Pack

Generated workbook pack for mixed PMO ingest/report/recommend evaluations. Each workbook keeps the PMO_02 sheet set and header-row contract so it can be ingested by the current PMO pipeline.

## Files

- `PMO_EVAL_01_baseline.xlsx` - Control workbook copied from PMO_02_RA_Timesheet_Monitoring.xlsx.
- `PMO_EVAL_02_duplicate_dedupe.xlsx` - Adds exact duplicate allocation and timesheet rows. Correct ingest should not double-count them.
- `PMO_EVAL_03_rebalance_full_solution.xlsx` - Creates a clear overbooked BE source and an idle compatible BE target with enough spare capacity.
- `PMO_EVAL_04_rebalance_partial_relief.xlsx` - Source is severely overbooked; compatible candidates can absorb only part of the required reduction.
- `PMO_EVAL_05_rebalance_no_valid_candidate.xlsx` - Source is overbooked, but compatible BE candidates have no spare capacity; other candidates fail skill fit.
- `PMO_EVAL_06_exclusion_leave_holiday_ot.xlsx` - Highlights approved leave, public holiday, training, and approved OT compensation exclusions.
- `PMO_EVAL_07_onboarding_missing_weeks.xlsx` - Member joins mid-range with missing earlier timesheets and allocations.
- `PMO_EVAL_08_schema_tolerance.xlsx` - Shuffles selected columns and changes header case/whitespace while preserving sheet names and header rows.
- `answer_key.json` - machine-readable expected findings, recommendation groups, data-quality flags, and prompts.
- `answer_key.csv` - flattened review sheet for manual scoring.

## Workbook Contract

All workbooks include these sheets:

- `DS01_Resource_Allocation`
- `DS02_Timesheet_Log`
- `DS03_Overbook_Idle_Config`
- `DS04_Leave_Holiday_Records`
- `DS05_Project_Master` with headers on row 2
- `DS06_Member_Master` with headers on row 2
- `REF_Calendar_Weeks`
- `REF_KPI_Norms`
- `Answer_Key` (excluded by parser)

## Intended Eval Flow

1. Run workbook profiling and schema detection.
2. Normalize and stage the canonical PMO tables.
3. Publish after approval, compute facts, and generate report output.
4. Run rebalance recommendations where the answer key has expected recommendation groups.
5. Compare actual findings/recommendation statuses/top targets with `answer_key.json`.

The answer key is a required-expectation set, not a full replacement for row-level audit output. Some cases intentionally allow extra source-row metadata or data-quality context when the ingest pipeline explains it deterministically.
