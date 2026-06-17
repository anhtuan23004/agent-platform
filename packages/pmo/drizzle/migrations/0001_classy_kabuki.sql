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
	"busy_rate" real,
	"effort_consumption" real,
	"utilization" real,
	"rag_color" text NOT NULL,
	"issue_type" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mwf_member_week_unique" ON "pmo"."member_week_facts" USING btree ("tenant_id","member_id","week_id");--> statement-breakpoint
CREATE INDEX "mwf_tenant_issue" ON "pmo"."member_week_facts" USING btree ("tenant_id","issue_type");