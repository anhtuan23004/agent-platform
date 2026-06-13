CREATE SCHEMA "pmo";
--> statement-breakpoint
CREATE TABLE "pmo"."calendar_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"week_id" text NOT NULL,
	"week_start" timestamp with time zone NOT NULL,
	"week_end" timestamp with time zone NOT NULL,
	"working_days" integer NOT NULL,
	"holiday_hours_ft" real,
	"note" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."ingestion_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"source_file_key" text NOT NULL,
	"source_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"reporting_period_key" text,
	"reporting_period_start" timestamp with time zone,
	"reporting_period_end" timestamp with time zone,
	"detected_schema" jsonb,
	"confirmed_mapping" jsonb,
	"workbook_confidence" real,
	"change_summary" jsonb,
	"publish_decision" text,
	"publish_reviewed_by" uuid,
	"publish_reviewed_at" timestamp with time zone,
	"publish_review_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pmo"."kpi_norms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"norm_id" text NOT NULL,
	"metric" text NOT NULL,
	"formula" text,
	"green" text,
	"yellow" text,
	"red" text,
	"used_for" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."leave_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"record_id" text,
	"member_id" text,
	"leave_date" timestamp with time zone NOT NULL,
	"leave_type" text NOT NULL,
	"approved" boolean,
	"duration_days" real,
	"note" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."member_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"member_id" text NOT NULL,
	"full_name" text NOT NULL,
	"department" text,
	"role_title" text,
	"level" text,
	"line_manager_id" text,
	"employment_status" text,
	"employment" text,
	"std_hours_week" real,
	"join_date" timestamp with time zone,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."overbook_idle_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"overbook_threshold" real NOT NULL,
	"overbook_red_threshold" real,
	"idle_threshold" real NOT NULL,
	"mismatch_pct_threshold" real,
	"ot_max_hours_per_week" real,
	"effective_date" timestamp with time zone,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."project_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"account_id" text,
	"project_type" text,
	"status" text,
	"pm_id" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."resource_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"member_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text,
	"allocation_pct" real NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"weekly_planned_hours" real,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."staging_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingestion_session_id" uuid NOT NULL,
	"table_id" text NOT NULL,
	"natural_key_hash" text NOT NULL,
	"change_type" text NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb NOT NULL,
	"natural_key_display" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"member_id" text NOT NULL,
	"project_id" text,
	"work_date" timestamp with time zone NOT NULL,
	"logged_hours" real NOT NULL,
	"log_category" text,
	"task_ref" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cal_natural_key_unique" ON "pmo"."calendar_weeks" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "cal_tenant_active" ON "pmo"."calendar_weeks" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "ingestion_sessions_tenant_status" ON "pmo"."ingestion_sessions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ingestion_sessions_tenant_period" ON "pmo"."ingestion_sessions" USING btree ("tenant_id","reporting_period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_natural_key_unique" ON "pmo"."kpi_norms" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "kpi_tenant_active" ON "pmo"."kpi_norms" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_natural_key_unique" ON "pmo"."leave_records" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "leave_tenant_active" ON "pmo"."leave_records" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "leave_member" ON "pmo"."leave_records" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_natural_key_unique" ON "pmo"."member_master" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "member_tenant_active" ON "pmo"."member_master" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "config_natural_key_unique" ON "pmo"."overbook_idle_config" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "config_tenant_active" ON "pmo"."overbook_idle_config" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "proj_natural_key_unique" ON "pmo"."project_master" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "proj_tenant_active" ON "pmo"."project_master" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "ra_natural_key_unique" ON "pmo"."resource_allocations" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "ra_tenant_active" ON "pmo"."resource_allocations" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "ra_member_project" ON "pmo"."resource_allocations" USING btree ("tenant_id","member_id","project_id");--> statement-breakpoint
CREATE INDEX "staging_session_type" ON "pmo"."staging_changes" USING btree ("ingestion_session_id","change_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ts_natural_key_unique" ON "pmo"."timesheets" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "ts_tenant_active" ON "pmo"."timesheets" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "ts_member_date" ON "pmo"."timesheets" USING btree ("tenant_id","member_id","work_date");