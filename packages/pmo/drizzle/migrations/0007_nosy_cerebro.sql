CREATE TABLE "pmo"."member_skills_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"skill_key" text NOT NULL,
	"skill_name" text NOT NULL,
	"proficiency_level" integer,
	"evidence_confidence" real DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"source_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pmo"."task_history_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"history_id" text NOT NULL,
	"member_id" text NOT NULL,
	"project_id" text,
	"allocation_role" text,
	"task_title" text NOT NULL,
	"task_summary" text,
	"skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"evidence_confidence" real DEFAULT 1 NOT NULL,
	"embedding" jsonb,
	"embedding_model_id" text,
	"embedding_source_hash" text,
	"source" text NOT NULL,
	"source_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_skills_projection_idempotency" ON "pmo"."member_skills_projection" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "member_skills_projection_member" ON "pmo"."member_skills_projection" USING btree ("tenant_id","member_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "task_history_projection_idempotency" ON "pmo"."task_history_projection" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "task_history_projection_member_date" ON "pmo"."task_history_projection" USING btree ("tenant_id","member_id","completed_at");--> statement-breakpoint
CREATE INDEX "task_history_projection_project" ON "pmo"."task_history_projection" USING btree ("tenant_id","project_id");