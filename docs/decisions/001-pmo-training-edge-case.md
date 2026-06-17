# Decision: PMO Training Edge Case Handling

## Context
In PMO Dataset 02 (Resource Allocation & Timesheet Monitoring), "Training" is defined as a valid edge case so that members are not incorrectly flagged as "Idle" (sitting without project allocation) when they are actually attending training courses.
Previously, the `available-hours` calculation correctly kept training hours in the pool (meaning they were still "available"), but the `findings` logic did not suppress the "Idle" or "Mismatch" flags for weeks where training occurred, leading to false positives.
Additionally, the N12 (Training Compliance) metric (`Done / Required`) was missing.

## Decision
1. **Update `analyzeMembers` in `findings.ts`**:
   Introduced a `hasTraining` check against the `LeaveRow` array (where `leave_type` is 'training' and `approved === true`). Weeks containing approved training are now added to `excludedWeeks` with `reason: 'training'`, suppressing false Idle/Mismatch alerts while keeping the context visible for audits.
2. **Member-level aggregation exclusions (busy + N06)**:
   Holiday, approved-leave, approved-OT, and training weeks are excluded from both member-level busy rate and effort consumption. Per-week N06 remains `logged / planned` (REF_KPI_Norms); member-level EC is `Σlogged / Σplanned` over non-excluded weeks only.
3. **Implement N12 Metric in `metrics.ts`**:
   Added `trainingCompliance` field to `MemberWeekFact`. The formula used is `trainingHours / requiredTrainingHours`. To prevent artificial inflation of metrics across aggregations, the value is capped at `1` (100%) using `Math.min(..., 1)`.
4. **Data Persistence**:
   All new metric columns (N03, N04, N05, N12) are fully persisted to the read-model database using Drizzle upsert in `persist-facts.ts`.
5. **PMO_02 mock tooling**:
   `insert-mock.ts` publishes cleaned canonical rows to `mock-data.db`; `generate-mock-report.ts` validates analytics against the Answer_Key without re-running ingestion dedup.

## Status
Implemented
