ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "source_file_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_goal" text;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_plan" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_plan_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_feedback_history" jsonb;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_last_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "planning_approved_at" timestamp with time zone;