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
CREATE INDEX "report_runs_tenant_created" ON "pmo"."report_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_ingestion_session" ON "pmo"."report_runs" USING btree ("ingestion_session_id");
