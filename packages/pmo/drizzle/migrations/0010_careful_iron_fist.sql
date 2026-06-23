CREATE TABLE "pmo"."project_demand_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"natural_key_hash" text NOT NULL,
	"source_row_hash" text NOT NULL,
	"last_ingestion_session_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"demand_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role_needed" text NOT NULL,
	"required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"demand_start" timestamp with time zone NOT NULL,
	"demand_end" timestamp with time zone NOT NULL,
	"demand_pct" real,
	"demand_hours_per_week" real,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"priority_score" real,
	"confirmed" boolean DEFAULT false NOT NULL,
	"demand_source" text DEFAULT 'seeded_mock' NOT NULL,
	"note" text,
	"source_row" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_demand_plan_period_check" CHECK ("pmo"."project_demand_plan"."demand_end" >= "pmo"."project_demand_plan"."demand_start"),
	CONSTRAINT "project_demand_plan_capacity_check" CHECK ("pmo"."project_demand_plan"."demand_pct" IS NOT NULL OR "pmo"."project_demand_plan"."demand_hours_per_week" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_demand_plan_natural_key_unique" ON "pmo"."project_demand_plan" USING btree ("tenant_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "project_demand_plan_tenant_active" ON "pmo"."project_demand_plan" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "project_demand_plan_project_period" ON "pmo"."project_demand_plan" USING btree ("tenant_id","project_id","demand_start","demand_end");