CREATE TABLE "pmo"."member_week_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"last_ingestion_session_id" uuid,
	"member_id" text NOT NULL,
	"week_id" text NOT NULL,
	"scope_status" text NOT NULL,
	"available_hours" real NOT NULL,
	"planned_hours" real NOT NULL,
	"logged_hours" real NOT NULL,
	"expected_logged_hours" real NOT NULL,
	"billable_hours" real DEFAULT 0 NOT NULL,
	"bench_hours" real DEFAULT 0 NOT NULL,
	"overtime_hours" real DEFAULT 0 NOT NULL,
	"training_hours" real DEFAULT 0 NOT NULL,
	"busy_rate" real,
	"utilization" real,
	"billable_rate" real,
	"bench_rate" real,
	"overtime_ratio" real,
	"effort_consumption" real,
	"training_compliance" real,
	"rag_color" text NOT NULL,
	"issue_type" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ingestion_session_id" uuid,
	"report_types" jsonb NOT NULL,
	"date_range_start" timestamp with time zone NOT NULL,
	"date_range_end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"result_summary" jsonb,
	"result_payload" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pmo"."overbook_idle_config" ADD COLUMN "required_training_hours" real;--> statement-breakpoint
CREATE UNIQUE INDEX "mwf_member_week_unique" ON "pmo"."member_week_facts" USING btree ("tenant_id","member_id","week_id");--> statement-breakpoint
CREATE INDEX "mwf_tenant_issue" ON "pmo"."member_week_facts" USING btree ("tenant_id","issue_type");--> statement-breakpoint
CREATE INDEX "report_runs_tenant_created" ON "pmo"."report_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_ingestion_session" ON "pmo"."report_runs" USING btree ("ingestion_session_id");