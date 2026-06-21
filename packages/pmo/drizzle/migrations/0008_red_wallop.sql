ALTER TABLE "pmo"."report_runs" ADD COLUMN "source_mode" text DEFAULT 'canonical_db' NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "granularity" text DEFAULT 'member_week' NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "filters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "rule_set_id" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "rule_version" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "rule_sha256" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "rule_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "facts_computed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "facts_version" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "canonical_data_version" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "recommendation_config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "embedding_model_id" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "embedding_source_version" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "html_s3_key" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "html_sha256" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "html_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "pdf_s3_key" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "pdf_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "pdf_page_count" integer;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "failure_message" text;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "report_runs_tenant_status" ON "pmo"."report_runs" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD CONSTRAINT "report_runs_status_check" CHECK ("pmo"."report_runs"."status" IN ('queued','computing','rendering','completed','failed'));--> statement-breakpoint
ALTER TABLE "pmo"."report_runs" ADD CONSTRAINT "report_runs_source_mode_check" CHECK ("pmo"."report_runs"."source_mode" IN ('canonical_db','after_upload_publish'));