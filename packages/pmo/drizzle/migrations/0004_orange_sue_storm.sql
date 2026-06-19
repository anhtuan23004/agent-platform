ALTER TABLE "pmo"."ingestion_sessions" ALTER COLUMN "source_file_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ALTER COLUMN "source_file_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ALTER COLUMN "mime_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pmo"."ingestion_sessions" ADD COLUMN "source_kind" text DEFAULT 'workbook' NOT NULL;