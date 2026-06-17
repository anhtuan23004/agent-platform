## PMO_02 mock-data.db report (clean canonical input → analytics)

- Source workbook: `hackathon/data/PMO_02_RA_Timesheet_Monitoring.xlsx`
- SQLite DB: `mock-data.db`
- Contract: ingestion has already deduped RA + aggregated timesheets; analytics reads active canonical rows only.

### Inputs
- weeks: **6**
- members: **30**
- allocs: **39**
- timesheets: **1116**
- leaves: **11**

### Thresholds (from overbook_idle_config)
- overbook_threshold: **1.1**
- overbook_red_threshold: **1.2**
- idle_threshold: **0.75**
- mismatch_pct_threshold: **0.2**

### Finding counts
- Idle: **6**
- Mismatch_overlog: **1**
- Mismatch_underlog: **1**
- Overbook: **2**

### Top findings (first 30)
member_id | issue | rag | busyRate | effortConsumption
---|---|---:|---:|---:
EMP-004|Overbook|red|1.2500|1.0000
EMP-001|Overbook|yellow|1.1500|1.0174
EMP-006|Mismatch_overlog|red|0.9500|1.2737
EMP-002|Mismatch_underlog|red|0.9000|0.5333
EMP-005|Idle|red|0.6000|1.0000
EMP-008|Idle|red|0.5000|1.0000
EMP-011|Idle|red|0.0000|
EMP-012|Idle|red|0.0000|
EMP-101|Idle|red|0.0000|
EMP-102|Idle|red|0.0000|

### Excluded weeks (member-level)
- approved_leave: **1**
- approved_ot: **1**
- holiday_week: **30**
- training: **0**

### Answer Key comparison (member-level)
member_id | expected_issue_type(s) | found_issue(s)
---|---|---
EMP-001|Overbook|Overbook
EMP-002|Mismatch_underlog|Mismatch_underlog
EMP-003|Edge_exclude|
EMP-004|Overbook|Overbook
EMP-005|Idle|Idle
EMP-006|Mismatch_overlog|Mismatch_overlog
EMP-007|Guardrail_parttime|
EMP-008|Idle|Idle
EMP-009|Edge_onboard_missing|
EMP-010|Data_duplicate|
