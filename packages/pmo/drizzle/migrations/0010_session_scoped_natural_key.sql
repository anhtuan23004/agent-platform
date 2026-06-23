-- Drizzle cannot model dropping and recreating composite unique indexes in generated migrations.
DROP INDEX IF EXISTS "pmo"."ra_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "ra_session_natural_key_unique" ON "pmo"."resource_allocations" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."ts_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "ts_session_natural_key_unique" ON "pmo"."timesheets" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."leave_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "leave_session_natural_key_unique" ON "pmo"."leave_records" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."proj_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "proj_session_natural_key_unique" ON "pmo"."project_master" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."member_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "member_session_natural_key_unique" ON "pmo"."member_master" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."config_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "config_session_natural_key_unique" ON "pmo"."overbook_idle_config" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."cal_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "cal_session_natural_key_unique" ON "pmo"."calendar_weeks" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");--> statement-breakpoint
DROP INDEX IF EXISTS "pmo"."kpi_natural_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_session_natural_key_unique" ON "pmo"."kpi_norms" USING btree ("tenant_id","last_ingestion_session_id","natural_key_hash");
