DROP INDEX "tool_calls_tenant_idx";--> statement-breakpoint
CREATE INDEX "tool_calls_tenant_idx" ON "tool_calls" USING btree ("tenant_id", "tool_name");--> statement-breakpoint
DROP INDEX "events_tenant_type_idx";--> statement-breakpoint
CREATE INDEX "events_tenant_type_idx" ON "events" USING btree ("tenant_id", "event_type");
