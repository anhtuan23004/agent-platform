ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "billable_hours" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "bench_hours" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "overtime_hours" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "training_hours" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "billable_rate" real;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "bench_rate" real;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "overtime_ratio" real;--> statement-breakpoint
ALTER TABLE "pmo"."member_week_facts" ADD COLUMN "training_compliance" real;--> statement-breakpoint
ALTER TABLE "pmo"."overbook_idle_config" ADD COLUMN "required_training_hours" real;