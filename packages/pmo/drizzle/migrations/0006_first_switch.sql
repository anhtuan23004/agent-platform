CREATE TABLE "pmo"."member_week_fact_versions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"facts_version" text NOT NULL,
	"canonical_data_version" text NOT NULL,
	"facts_schema_version" text NOT NULL,
	"last_ingestion_session_id" uuid,
	"computed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- chat_thread_id already added by 0004_unique_outlaw_kid.sql; duplicate removed