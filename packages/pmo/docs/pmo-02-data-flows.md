# Luồng data PMO_02

Tài liệu này giải thích cách file `PMO_02_RA_Timesheet_Monitoring.xlsx` đi từ
raw workbook đến finding của PMO. Khi một số liệu nhìn "sai sai", hãy chọn
member cần kiểm tra rồi lần theo từng luồng dưới đây.

## Bức tranh tổng quát

```text
Workbook sheets
  -> detect sheet + map cột vào canonical schema
  -> bảng canonical pmo.* với active rows
  -> tách population: PM riêng, delivery member riêng
  -> fact member x week
  -> phân tích member-level, có excludedWeeks
  -> finding: overbook / idle / mismatch_under / mismatch_over
```

Quy tắc quan trọng về grain:

- `member_week_project_facts` là **grain gốc** (member × week × project): plan/log từng project;
  gồm cả project **Completed** khi RA/timesheet còn trong cửa sổ báo cáo.
- `member_week_facts` (persisted) là **rollup** từ project grain → member × week cho finding,
  RAG, busy/idle. Planned = SUM(project); logged/billable vẫn đọc full timesheet member.
- **Allocation matrix** (member × project, window rollup): chỉ project **Active** — dùng rebalance.
- PM (`project_master.pm_id` hoặc role title PM/Project Manager/PMO) là population
  riêng. Không trộn PM vào utilization finding của delivery member, nhưng vẫn xuất hiện
  trong trace nếu có RA/log.
- Finding PMO là verdict ở cấp member. Đừng kết luận từ một tuần lẻ trước khi
  áp dụng loại trừ holiday, leave, training, approved OT.
- Project **Completed** trong DS05 (vd. `PRJ-H-*`) thường là lịch sử: không có RA/timesheet
  trong cửa sổ hiện tại nên không hiện ở trace — mở rộng date range về tuần còn overlap
  lifecycle project để thấy chi tiết.

## Luồng 1: Workbook sheet -> canonical table

| Sheet trong workbook | Ý nghĩa | Bảng canonical | Dùng để tính |
| --- | --- | --- | --- |
| `DS01_Resource_Allocation` | Kế hoạch phân bổ member vào project theo date range | `resource_allocations` | `plannedHours` |
| `DS02_Timesheet_Log` | Giờ thực tế log hằng ngày | `timesheets` | `loggedHours`, billable/training |
| `DS03_Overbook_Idle_Config` | Threshold PMO | `overbook_idle_config` | RAG và finding thresholds |
| `DS04_Leave_Holiday_Records` | Holiday, leave, training, approved OT | `leave_records` | availability và exclusions |
| `DS05_Project_Master` | Danh mục project | `project_master` | reference/validation |
| `DS06_Member_Master` | Capacity, join date, part-time/full-time | `member_master` | standard week, pre-hire |
| `REF_Calendar_Weeks` | Tuần báo cáo và working days | `calendar_weeks` | week window, holiday capacity |
| `REF_KPI_Norms` | Công thức tham chiếu | không phải fact source | kiểm chứng formula |
| `Answer_Key` | Grading key | không ingest | validation demo/test |

Điểm dễ sai: RA phải được dedupe trước analytics. Trong workbook này,
`EMP-010 x PRJ-002` bị duplicate một row. Nếu cộng cả hai row, EMP-010 sẽ bị
false overbook.

## Luồng 2: Capacity và availability

Trước khi tính availability, analytics tách người thành hai nhóm:

- **PM population**: member là `pm_id` của project hoặc `role_title` thể hiện PM/PMO.
- **Delivery member population**: các resource còn lại, dùng để tính RA/timesheet
  utilization.

Mục đích là tránh việc PM không có RA/log bị lẫn vào danh sách member delivery.
PM nên được review theo project ownership/escalation, không theo Busy/Idle của
delivery resource.

Availability trả lời câu hỏi: tuần đó người này thực sự có bao nhiêu giờ khả dụng?

```text
baseCapacity = stdHoursWeek * workingDays / 5
leaveHours = approved member-specific absence days * stdHoursWeek / 5
availableHours = max(0, baseCapacity - leaveHours)
```

Quy tắc:

- Part-time lấy từ `DS06_Member_Master.Std_hours_week`.
- Company-wide holiday lấy từ `REF_Calendar_Weeks.Working_days`; không trừ thêm
  row leave có `member_id = null`, nếu không sẽ double-count holiday.
- Approved annual/sick/maternity/unpaid leave làm giảm availability.
- `Approved OT Comp` không làm giảm availability; nó đánh dấu extra work đã được duyệt.
- `Training` không làm giảm availability; nó là valid edge case riêng.

Ví dụ:

- `EMP-007` có `Std_hours_week = 20`. Plan 16h nghĩa là `16 / 20 = 80%`, không
  phải `16 / 40`.
- `W3` có `working_days = 4`, nên full-time availability là `32h`.

## Luồng 3: Planned hours

Planned hours trả lời câu hỏi: theo RA, member được kỳ vọng làm bao nhiêu giờ?

```text
plannedHours = sum(weekly_planned_hours)
  cho các allocation active trong tuần
```

Allocation active nếu date range của allocation overlap với week.

Ví dụ:

- `EMP-004`: `32 + 18 = 50h` mỗi tuần thường.
- `EMP-001`: `24 + 22 = 46h`.
- `EMP-010`: sau dedupe là `24 + 20 = 44h`; nếu dùng raw duplicate sẽ thành `64h`.

## Luồng 4: Logged hours và category

Logged hours trả lời câu hỏi: timesheet thực tế đã submit bao nhiêu giờ?

```text
loggedHours = sum(logged_hours) với work_date nằm trong tuần
billableHours = logged hours có log_category = Project
trainingHours = logged hours có log_category = Training
```

`Project` là billable. `Training`, `Internal`, `Admin` không tính vào billable rate.

## Luồng 5: Weekly KPI facts

Mỗi `member x week` được tính các KPI:

| KPI | Công thức | Ý nghĩa |
| --- | --- | --- |
| N01 Busy | `plannedHours / availableHours` | tín hiệu overbook/idle |
| N02 Utilization | `loggedHours / availableHours` | cường độ làm thực tế |
| N03 Billable | `billableHours / loggedHours` | tỷ lệ giờ tạo doanh thu |
| N04 Bench | `max(0, availableHours - plannedHours) / availableHours` | capacity chưa được assign |
| N05 Overtime | `approvedOtHours / stdHoursWeek` | OT đã được duyệt |
| N06 Effort Consumption | `loggedHours / plannedHours` | logged-vs-planned mismatch |
| N12 Training Compliance | `trainingHours / requiredTrainingHours`, cap ở 1 | optional training metric |

Các KPI tuần dùng để truy vết. Finding cuối cùng không nên quyết định từ một
tuần đơn lẻ.

## Luồng 6: Scope và exclusion trước khi flag

Trước khi tạo finding member-level, analytics bỏ qua các tuần làm méo ratio:

| Reason | Khi nào xảy ra | Diễn giải |
| --- | --- | --- |
| `pre_hire` | `join_date > week_end` | thiếu RA/log trước onboarding không phải idle |
| `holiday_week` | `holiday_hours_ft > 0` | holiday làm méo weekly ratios |
| `approved_leave` | `availableHours = 0` | full leave week hợp lệ |
| `approved_ot` | có `Approved OT Comp` đã duyệt trong tuần | extra hours đã được duyệt |
| `training` | có `Training` đã duyệt trong tuần | onboarding/training hợp lệ |
| `no_plan` | có availability nhưng `planned=0` và `logged=0` | planning gap, không phải idle finding |

`pre_hire` nằm ở `scopeStatus = PRE_HIRE`. Các reason còn lại nằm trong
`excludedWeeks` ở analysis/finding.

## Luồng 7: Member-level calculation

Sau khi loại các tuần edge case:

```text
memberBusy = average(weekly busyRate)
memberEffortConsumption = sum(loggedHours) / sum(plannedHours)
```

Threshold từ `DS03_Overbook_Idle_Config`:

- `overbookThreshold = 1.10`
- `overbookRedThreshold = 1.20`
- `idleThreshold = 0.75`
- `mismatchPctThreshold = 0.20`

Rule flag:

- Overbook yellow: `memberBusy > 1.10`
- Overbook red: `memberBusy > 1.20`
- Idle red: `memberBusy < 0.75`
- Mismatch under: `memberEffortConsumption < 0.80`
- Mismatch over: `memberEffortConsumption > 1.20`

Chi tiết biên: đúng `1.10` không bị overbook, vì rule là `> 1.10`.

## Luồng 8: Expected outcome của PMO_02

Finding thật:

| Member | Expected | Lý do |
| --- | --- | --- |
| `EMP-004` | Overbook red | Busy `50 / 40 = 125%` |
| `EMP-001` | Overbook yellow | Busy `46 / 40 = 115%` |
| `EMP-005` | Idle red | Busy `24 / 40 = 60%` |
| `EMP-008` | Idle red | Busy `20 / 40 = 50%` |
| `EMP-002` | Mismatch underlog | EC khoảng `53%`, không có leave/OT hợp lệ |
| `EMP-006` | Mismatch overlog | EC khoảng `127%`, không có approved OT |

Edge case hợp lệ, không flag:

| Member/week | Nhìn nghi ngờ vì | Cách hiểu đúng |
| --- | --- | --- |
| `EMP-003 W2` | planned 40h, logged 0h | full approved leave, exclude |
| `EMP-003 W5` | logged 52h | approved OT, exclude |
| `W3` all members | log thấp hoặc busy phình lên | company holiday week, exclude ở member-level |
| `EMP-009 W1-W2` | RA/log trống | pre-hire, không phải idle |
| `EMP-009 W3` | training log, không có project log | approved onboarding training, exclude |
| `EMP-010` | raw RA có thể sum thành 64h | duplicate RA phải bỏ; clean plan là 44h |
| `EMP-007` | absolute hours thấp | part-time standard week là 20h; busy là 80% |

## Cách trace một member nghi ngờ

1. Xem member master: `std_hours_week`, `join_date`.
2. Xem calendar week: `working_days`, `holiday_hours_ft`.
3. Xem leave records trong tuần đó.
4. Cộng RA active để ra planned hours.
5. Cộng timesheet để ra logged hours và category.
6. Tính weekly KPI.
7. Áp dụng scope/exclusion reasons.
8. Tính lại member-level Busy và EC từ các tuần còn lại.
9. So với threshold.

Nếu số liệu thay đổi sau bước 7, khả năng cao đó là edge case hợp lệ, không phải
finding thật.

## Code map

| Việc cần hiểu | File |
| --- | --- |
| Load canonical rows | `packages/pmo/src/backend/analytics/load-canonical.ts` |
| Availability và approved OT | `packages/pmo/src/backend/analytics/available-hours.ts` |
| Planned/logged/billable/training hours | `packages/pmo/src/backend/analytics/planned-hours.ts` |
| PM/member population split | `packages/pmo/src/backend/analytics/populations.ts` |
| Project → PM → member dependency view | `packages/pmo/src/backend/analytics/project-members.ts` |
| Weekly KPI formulas | `packages/pmo/src/backend/analytics/metrics.ts` |
| Grid member-week facts | `packages/pmo/src/backend/analytics/member-week-facts.ts` |
| Member aggregation và finding detection | `packages/pmo/src/backend/analytics/findings.ts` |
| Threshold resolution | `packages/pmo/src/backend/analytics/thresholds.ts` |
| Demo answer-key fixture | `packages/pmo/src/backend/analytics/demo-fixture.ts` |
| Formula reference | `packages/pmo/docs/formulas.md` |
