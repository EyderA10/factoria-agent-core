CREATE TABLE "rate_limit_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_counters_scope_key_window_idx" ON "rate_limit_counters" USING btree ("scope","key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedupe_key_idx" ON "events" USING btree ("dedupe_key");