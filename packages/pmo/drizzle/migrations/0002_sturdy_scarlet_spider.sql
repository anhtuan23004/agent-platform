ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "workflow_execution_state" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "profiling_documents" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "profiling_summary" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "workflow_current_step" text;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "workflow_step_status" text;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "workflow_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "workflow_updated_at" timestamp with time zone;