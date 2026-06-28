# UAT guide cho PMO Agent

Tài liệu này hướng dẫn User Acceptance Testing cho luồng `PMO Agent` trong Seta. Phạm vi bám theo implementation hiện tại của module PMO: upload workbook, sinh plan, các bước review có human approval, publish dữ liệu canonical, xem utilization analytics, và tạo report PDF từ dữ liệu đã publish.

## 1. Mục tiêu UAT

Xác nhận rằng PMO Agent:

- cho đúng người dùng truy cập đúng chức năng theo RBAC
- nhận workbook PMO hợp lệ và tạo plan đúng intent
- dừng đúng ở các cổng review trước khi có thay đổi ghi dữ liệu
- chỉ publish khi có user xác nhận
- tính analytics nhất quán trên dữ liệu đã publish
- tạo report từ persisted PMO facts và cho tải PDF khi job hoàn tất

## 2. Phạm vi

Bao gồm:

- trang `PMO Agent` tại `/pmo/agent`
- trang `Utilization` tại `/pmo/demo-calculation`
- luồng ingest workbook PMO
- review các bước `profiling`, `mapping`, `normalization`, `publish`, `report`
- report canonical-data qua `Generate PDF`

Không bao gồm:

- xác minh chất lượng model LLM ở mức prompt engineering
- benchmark hiệu năng tải lớn
- self-hosting, S3, ECS, hoặc hạ tầng production
- multi-tenant isolation ở mức pentest

## 3. Điều kiện tiên quyết

Chuẩn bị môi trường local theo [docs/dev-quickstart.md](/home/dungvu/workspace/code/github/agent-platform/docs/dev-quickstart.md).

Tối thiểu cần có:

- `pnpm install`
- `.env` đã điền `BETTER_AUTH_SECRET`, `CRYPTO_LOCAL_MASTER_KEY`, `OPENAI_API_KEY`
- `pnpm db:up`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm dev`

Đăng nhập web tại `http://localhost:5173/login`.

Tài khoản gợi ý:

- `admin@hackathon.com` / `ChangeMe@2026`
- hoặc tenant sandbox được tạo bằng `scripts/tenant-bootstrap.sh`

## 4. Vai trò test

### 4.1 PMO operator

Role cần có:

- `pmo.operator`

Kỳ vọng quyền:

- thấy menu `Pmo`
- vào được `Overview`, `Utilization`, `PMO Agent`
- được upload workbook
- được confirm intent, approve plan, review mapping/normalization/publish/report

### 4.2 PMO viewer

Role cần có:

- `pmo.viewer`

Kỳ vọng quyền:

- thấy menu `Pmo`
- xem được dữ liệu PMO và utilization
- không có quyền upload hay xác nhận các bước ingest/write

## 5. Dữ liệu test

Ưu tiên dùng dataset seed mặc định từ `pnpm db:seed`, trong đó có dữ liệu `PMO_02`.

Workbook tham chiếu:

- `PMO_02_RA_Timesheet_Monitoring.xlsx`

Expected analytics tham chiếu:

- [pmo-02-data-flows.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/docs/pmo-02-data-flows.md)

Expected report window ví dụ:

- `2026-06-29` đến `2026-08-07`

Expected findings chính của PMO_02:

- `EMP-004` overbook red
- `EMP-001` overbook yellow
- `EMP-005` idle red
- `EMP-008` idle red
- `EMP-002` mismatch under
- `EMP-006` mismatch over

## 6. Tiêu chí pass/fail tổng thể

Pass khi:

- tất cả test case mức `High` pass
- không có lỗi làm publish sai dữ liệu hoặc bỏ qua approval
- report PDF tạo được từ dữ liệu published
- analytics hiển thị các finding chính khớp dataset PMO_02

Fail khi có ít nhất một lỗi:

- user không đúng role vẫn có thể ghi dữ liệu
- luồng publish không chặn ở bước approval
- publish xong không xem được utilization từ canonical data
- report không hoàn tất dù dữ liệu và date range hợp lệ

## 7. Danh sách test case

### UAT-01: RBAC của PMO viewer và PMO operator

Mức độ:

- High

Bước test:

1. Đăng nhập bằng user có `pmo.operator`.
2. Xác nhận menu `Pmo` xuất hiện.
3. Mở `/pmo/agent`.
4. Kiểm tra có thể upload workbook hoặc thấy các action như `Analyze & Generate Plan`.
5. Đăng xuất.
6. Đăng nhập bằng user chỉ có `pmo.viewer`.
7. Xác nhận vẫn thấy menu `Pmo`.
8. Mở `/pmo/agent` và kiểm tra chỉ có khả năng xem, không có khả năng thực hiện ingest/write.

Kết quả mong đợi:

- `pmo.operator` có thể thao tác ingest
- `pmo.viewer` chỉ đọc, không có khả năng upload/confirm/publish

Ghi chú:

- Menu `Pmo` yêu cầu `pmo.data.read`.
- Quyền module hiện có là `pmo.operator` và `pmo.viewer`.

### UAT-02: Upload workbook và tạo session mới

Mức độ:

- High

Bước test:

1. Đăng nhập bằng `pmo.operator`.
2. Vào `/pmo/agent`.
3. Upload một file `.xlsx` hoặc `.xlsm` hợp lệ.
4. Chờ upload hoàn tất.
5. Kiểm tra panel `Upload history`.

Kết quả mong đợi:

- session mới xuất hiện trong `Upload history`
- cột `Workbook`, `Uploaded at`, `Operator`, `Status`, `Active gate`, `Progress` có dữ liệu
- session vừa upload được chọn hoặc có thể `View`

### UAT-03: Analyze & Generate Plan tạo plan đúng ngữ cảnh

Mức độ:

- High

Bước test:

1. Từ session vừa upload, bấm `Analyze & Generate Plan`.
2. Chờ hệ thống chuyển sang trạng thái plan review.
3. Mở phần `Plan`.
4. Kiểm tra `Interpreted goal`, `Plan status`, `Proposed workflow`.

Kết quả mong đợi:

- session chuyển sang trạng thái review plan, không fail
- workflow đề xuất phản ánh đúng mục tiêu ingest workbook PMO
- các bước hiển thị theo thứ tự logic, ví dụ profiling -> mapping -> normalization -> publish -> report nếu intent yêu cầu

### UAT-04: Intent cần xác nhận thì dừng đúng ở bước confirm

Mức độ:

- Medium

Bước test:

1. Tạo một session có intent mơ hồ hoặc có nhiều hướng xử lý.
2. Kiểm tra thẻ `Intent`.
3. Nếu hiện `Needs confirmation`, chọn một option trong `Choose workflow scope`.

Kết quả mong đợi:

- hệ thống không tự chạy tiếp khi intent chưa được xác nhận
- sau khi chọn option, intent được confirm và plan/execution mở khóa theo workflow đã chọn

### UAT-05: Regenerate plan với feedback người dùng

Mức độ:

- Medium

Bước test:

1. Trong trạng thái `Plan Review`, nhập feedback vào `Plan feedback`.
2. Bấm `Regenerate plan`.
3. Chờ hệ thống sinh lại plan.

Kết quả mong đợi:

- `Feedback history` lưu lại feedback đã nhập
- version plan tăng hoặc nội dung plan được cập nhật
- plan mới vẫn bám đúng workbook/session hiện tại

### UAT-06: Approve plan mới được bắt đầu execution

Mức độ:

- High

Bước test:

1. Ở `Plan Review`, bấm `Approve plan`.
2. Quan sát workflow cards/execution cards.

Kết quả mong đợi:

- execution chỉ bắt đầu sau khi plan được approve
- card đang active được đánh dấu là bước hiện tại
- các bước tương lai ở trạng thái khóa hoặc pending

### UAT-07: Profiling review hiển thị thông tin workbook trước khi map dữ liệu

Mức độ:

- Medium

Bước test:

1. Sau khi approve plan, chờ workflow tới bước profiling nếu có.
2. Mở phần profiling review.
3. Kiểm tra số sheet, row count, column count, area dự đoán.
4. Nếu UI cho phép override area hoặc ignore sheet, thực hiện một chỉnh sửa nhỏ rồi lưu.

Kết quả mong đợi:

- profiling summary hiển thị được metadata workbook
- các sheet được gán area hợp lý như resource allocation, timesheet, member master, project master
- thay đổi review được lưu và workflow có thể tiếp tục sau khi approve

### UAT-08: Mapping review yêu cầu người dùng xác nhận trước khi normalize

Mức độ:

- High

Bước test:

1. Chờ workflow tới bước `column_mapping`.
2. Kiểm tra các mapping item đang ở trạng thái pending/current.
3. Approve một item hiện tại.
4. Nếu có alternate mapping, thử chọn alternate rồi apply.
5. Tiếp tục đến khi workflow cho phép qua bước kế tiếp.

Kết quả mong đợi:

- mapping không tự đi tiếp nếu còn item cần review
- progress approved/total tăng đúng
- người dùng có thể modify mapping khi cần
- chỉ sau khi hoàn tất review mới được `continue`

### UAT-09: Normalization review chặn dữ liệu lỗi trước khi publish

Mức độ:

- High

Bước test:

1. Chờ workflow tới bước `normalize_to_staging` hoặc review normalization.
2. Kiểm tra các row có trạng thái `blocked`, `duplicate`, `warning`, `skipped`.
3. Với dữ liệu duplicate hoặc issue có thể xử lý, chọn quyết định phù hợp như keep/skip.
4. Approve để tiếp tục.

Kết quả mong đợi:

- các vấn đề dữ liệu được trình bày rõ theo table/group
- duplicate và row lỗi không bị publish âm thầm
- người dùng phải review trước khi workflow tiến sang publish

### UAT-10: Publish luôn có human approval trước khi ghi canonical data

Mức độ:

- Critical

Bước test:

1. Chờ workflow tới bước publish review.
2. Kiểm tra summary thay đổi DB.
3. Xác nhận chưa bấm approve thì dữ liệu published hiện tại chưa đổi.
4. Bấm approve publish.
5. Chờ workflow hoàn tất.

Kết quả mong đợi:

- không có canonical write trước lúc approve
- sau approve, session đạt trạng thái published/completed tương ứng
- upload history phản ánh tiến độ mới

### UAT-11: Utilization chỉ đọc dữ liệu đã publish

Mức độ:

- High

Bước test:

1. Vào `/pmo/demo-calculation`.
2. Nếu chưa publish dữ liệu nào, xác nhận hiển thị empty state phù hợp.
3. Sau khi publish session PMO_02, refresh trang `Utilization`.
4. Chọn source upload vừa publish nếu cần.

Kết quả mong đợi:

- khi chưa có published data, trang báo rõ chưa có dữ liệu usable
- sau publish, charts và pipeline xuất hiện
- dữ liệu không đọc từ staging chưa publish

### UAT-12: Analytics của PMO_02 khớp findings kỳ vọng

Mức độ:

- Critical

Bước test:

1. Tại `/pmo/demo-calculation`, lọc theo session PMO_02 đã publish.
2. Kiểm tra danh sách finding và số liệu utilization.
3. Tra cứu các member trọng điểm.

Kết quả mong đợi:

- `EMP-004` xuất hiện là overbook red
- `EMP-001` xuất hiện là overbook yellow
- `EMP-005` và `EMP-008` xuất hiện là idle red
- `EMP-002` là mismatch under
- `EMP-006` là mismatch over
- các edge case như holiday week, pre-hire, approved leave, training, approved OT không bị flag sai

Tham chiếu:

- [pmo-02-data-flows.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/docs/pmo-02-data-flows.md)

### UAT-13: Generate PDF report từ dữ liệu canonical

Mức độ:

- High

Bước test:

1. Vào `/pmo/agent` hoặc khu vực có panel `Resource allocation report`.
2. Nhập date range hợp lệ, ví dụ `2026-06-29` đến `2026-08-07`.
3. Bấm `Generate PDF`.
4. Theo dõi trạng thái report.
5. Khi report hoàn tất, bấm `Download PDF`.

Kết quả mong đợi:

- trạng thái đi qua `queued` -> `computing` -> `rendering` -> `completed`
- khi completed, nút `Download PDF` xuất hiện
- tải được file PDF
- finding counts có dữ liệu

### UAT-14: Retry report failed

Mức độ:

- Medium

Bước test:

1. Tạo một tình huống fail có kiểm soát nếu môi trường cho phép, hoặc dùng run lỗi có sẵn.
2. Khi report ở trạng thái `failed` và `Retry` xuất hiện, bấm `Retry`.

Kết quả mong đợi:

- report được re-queue
- hệ thống không tạo trạng thái mâu thuẫn
- nếu nguyên nhân lỗi đã hết, report hoàn tất thành công

### UAT-15: Session history cho phép theo dõi và xem lại workflow

Mức độ:

- Medium

Bước test:

1. Tạo ít nhất 2 session ingest.
2. Xem `Upload history`.
3. Dùng `View` để mở lại session cũ.
4. Nếu có session đang chạy, thử `Cancel`.

Kết quả mong đợi:

- mỗi session được persist và xem lại được
- progress/status của session cũ không bị mất
- cancel chỉ áp dụng khi session đủ điều kiện cancel

## 8. Checklist xác nhận cuối vòng UAT

- role `pmo.operator` thao tác được end-to-end
- role `pmo.viewer` không thể ghi dữ liệu
- upload workbook tạo session thành công
- plan được sinh, review, regenerate và approve đúng cách
- workflow dừng ở đúng gate review
- publish chỉ xảy ra sau approval
- utilization phản ánh canonical data đã publish
- findings chính của PMO_02 khớp tài liệu kỳ vọng
- report PDF sinh được và tải được

## 9. Cách ghi nhận lỗi

Mỗi lỗi nên ghi tối thiểu:

- mã test case, ví dụ `UAT-10`
- môi trường test
- tenant và user đang dùng
- workbook/session liên quan
- bước tái hiện
- kết quả thực tế
- kết quả mong đợi
- ảnh chụp màn hình hoặc `ingestion_session_id` / `reportRunId` nếu có

## 10. Tài liệu liên quan

- [docs/dev-quickstart.md](/home/dungvu/workspace/code/github/agent-platform/docs/dev-quickstart.md)
- [packages/pmo/README.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/README.md)
- [packages/pmo/docs/pmo-02-data-flows.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/docs/pmo-02-data-flows.md)
- [packages/pmo/docs/analytics-compute-contract.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/docs/analytics-compute-contract.md)
- [packages/pmo/docs/report-runbook.md](/home/dungvu/workspace/code/github/agent-platform/packages/pmo/docs/report-runbook.md)
