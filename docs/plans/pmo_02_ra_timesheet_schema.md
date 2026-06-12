git p# PMO_02_RA_Timesheet_Monitoring Schema

Source: PMO_02_RA_Timesheet_Monitoring(1).xlsx

Notes:
- LEGEND & SUMMARY is a descriptive sheet, not a primary business data table.
- Actual business tables are in DS, REF, and Answer_Key sheets.

## Table Overview
| Table | Grain | Meaning |
|---|---|---|
| DS01_Resource_Allocation | 1 row = 1 member x 1 project allocation | Planned staffing allocation by project |
| DS02_Timesheet_Log | 1 row = 1 member x 1 date x 1 project log | Actual work-hour log |
| DS03_Overbook_Idle_Config | 1 row = 1 rule configuration | Rule thresholds for overbook, idle, and mismatch detection |
| DS04_Leave_Holiday_Records | 1 row = 1 leave day or holiday record | Leave, holiday, training, approved OT compensation data |
| DS05_Project_Master | 1 row = 1 project | Project master data |
| DS06_Member_Master | 1 row = 1 member | Member master data |
| REF_Calendar_Weeks | 1 row = 1 monitoring week | Week calendar, working days, holidays |
| REF_KPI_Norms | 1 row = 1 KPI norm | KPI thresholds in Green, Yellow, Red bands |
| Answer_Key | 1 row = 1 expected finding | Expected agent answers; should be excluded in blind test distribution |

## DS01_Resource_Allocation
| Column | Data type | Meaning |
|---|---|---|
| Member_ID | String | Member ID, foreign key to DS06_Member_Master.Member_ID |
| Project_ID | String | Project ID, foreign key to DS05_Project_Master.Project_ID |
| Role | Enum | Allocation role code, for example BE, DE, ML, QA, DevOps |
| Allocation_pct | Float | Weekly allocation ratio, for example 0.45 means 45 percent |
| Start_date | Date | Allocation start date |
| End_date | Date | Allocation end date |
| Weekly_planned_hours | Float | Planned hours per week, usually Allocation_pct x Std_hours_week |

## DS02_Timesheet_Log
| Column | Data type | Meaning |
|---|---|---|
| Member_ID | String | Member ID, foreign key to DS06_Member_Master.Member_ID |
| Project_ID | String, nullable | Project ID, can be null for internal or training logs |
| Work_date | Date | Work date |
| Logged_hours | Float | Logged hours for the day |
| Log_category | Enum | Log category, for example Project, Internal, Training, Admin |
| Task_ref | String, nullable | Task reference ID, can be null |

## DS03_Overbook_Idle_Config
| Column | Data type | Meaning |
|---|---|---|
| Config_ID | String | Rule configuration ID |
| Rule_name | String | Rule set name |
| Overbook_threshold | Float | Overbook warning threshold, for example 1.10 |
| Overbook_red_threshold | Float | Red overbook threshold, for example 1.20 |
| Idle_threshold | Float | Idle threshold, for example below 0.75 |
| Mismatch_pct_threshold | Float | Logged vs planned mismatch threshold, for example 0.20 |
| OT_max_hours_per_week | Float | Maximum weekly OT hours before OT review is required |
| Effective_date | Date | Rule effective date |

## DS04_Leave_Holiday_Records
| Column | Data type | Meaning |
|---|---|---|
| Record_ID | String | Leave or holiday record ID |
| Member_ID | String, nullable | Member ID, null for company-wide holidays |
| Leave_date | Date | Leave, holiday, training, or approved OT comp date |
| Leave_type | Enum | Record type, for example Annual Leave, Public Holiday, Training, Approved OT Comp |
| Approved | Boolean | TRUE means the record is approved |
| Duration_days | Float | Duration in days, for example 1.0 or 0.5 |
| Note | String | Additional note |

## DS05_Project_Master
This sheet has one note row at row 1. The real header starts at row 2.

| Column | Data type | Meaning |
|---|---|---|
| Project_ID | String | Project ID, logical primary key |
| Project_name | String | Project name |
| Account_ID | String | Account or client group ID |
| Project_type | String | Project type, for example Software, AI/ML Platform, Integration, Data |
| Status | Enum | Project status, for example Active, Completed, On Hold, Cancelled |
| PM_ID | String | Project manager ID, foreign key to DS06_Member_Master.Member_ID |
| Start_date | Date | Project start date |
| End_date | Date | Planned or actual project end date |

## DS06_Member_Master
This sheet has one note row at row 1. The real header starts at row 2.

| Column | Data type | Meaning |
|---|---|---|
| Member_ID | String | Member ID, logical primary key |
| Full_name | String | Member full name |
| Department | String | Department, for example Backend, Data, AI/ML, PMO |
| Role_title | String | Job title |
| Level | String | Seniority level, for example L2, L3, L4, L5, L6 |
| Line_manager_id | String, nullable | Line manager ID, self-reference to Member_ID |
| Employment_status | Enum | Employment status, for example Active, Probation, On Leave, Resigned |
| Employment | Enum | Employment type, for example FT, PT |
| Std_hours_week | Float | Standard weekly hours, for example 40 for FT, 20 for PT |
| Join_date | Date | Join date, used for onboarding edge cases |

## REF_Calendar_Weeks
| Column | Data type | Meaning |
|---|---|---|
| Week_ID | String | Week ID, for example W1, W2, W3 |
| Week_start | Date | Week start date |
| Week_end | Date | Week end date |
| Working_days | Int | Number of working days in the week |
| Holiday_hours_ft | Float | Holiday hours reducing available hours for FT members |
| Note | String, nullable | Notes, for example a week with public holidays |

## REF_KPI_Norms
| Column | Data type | Meaning |
|---|---|---|
| Norm_ID | String | KPI norm ID |
| Metric | String | Metric name, for example Busy Rate, Utilization Rate, Billable Rate |
| Formula | String | Formula used to compute the metric |
| Green | String | Good threshold |
| Yellow | String | Warning threshold |
| Red | String | Error or high-risk threshold |
| Used_for | String | Purpose of KPI usage in this problem context |

## Answer_Key
This is an expected-answer table for agent evaluation. It should not be treated as business input for blind testing.

| Column | Data type | Meaning |
|---|---|---|
| Finding_ID | String | Finding ID |
| Problem | String | Related problem, for example Problem 2 |
| Entity_type | String | Entity type, for example Member, Week |
| Entity_id | String | Entity ID to detect, for example EMP-004, W3 |
| Issue_type | String | Issue type, for example Overbook, Idle, Mismatch_underlog |
| Expected_detection | String | Expected detection description |
| Severity | Enum | Severity level, for example High, Medium, Info |

## Primary Foreign-Key Relationships
| Relationship | Meaning |
|---|---|
| DS01_Resource_Allocation.Member_ID -> DS06_Member_Master.Member_ID | Allocation belongs to a member |
| DS01_Resource_Allocation.Project_ID -> DS05_Project_Master.Project_ID | Allocation belongs to a project |
| DS02_Timesheet_Log.Member_ID -> DS06_Member_Master.Member_ID | Timesheet log belongs to a member |
| DS02_Timesheet_Log.Project_ID -> DS05_Project_Master.Project_ID | Timesheet log references a project and can be null |
| DS04_Leave_Holiday_Records.Member_ID -> DS06_Member_Master.Member_ID | Leave record belongs to a member and can be null for company holidays |
| DS05_Project_Master.PM_ID -> DS06_Member_Master.Member_ID | Project manager of the project |
| DS06_Member_Master.Line_manager_id -> DS06_Member_Master.Member_ID | Direct reporting line relationship |
| Answer_Key.Entity_id -> Member_ID or Week_ID | Depends on Entity_type |