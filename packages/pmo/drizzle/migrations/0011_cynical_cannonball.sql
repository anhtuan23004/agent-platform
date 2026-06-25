CREATE TABLE "pmo"."agent_task_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"session_id" uuid,
	"original_goal" text NOT NULL,
	"decomposed_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_task_index" integer DEFAULT 0 NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_task_state_tenant_thread_uq" UNIQUE("tenant_id","thread_id")
);
--> statement-breakpoint
CREATE INDEX "agent_task_state_tenant_thread" ON "pmo"."agent_task_state" USING btree ("tenant_id","thread_id");--> statement-breakpoint
CREATE INDEX "agent_task_state_session" ON "pmo"."agent_task_state" USING btree ("session_id");
