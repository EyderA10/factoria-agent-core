CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"elevenlabs_agent_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'provisioned' NOT NULL,
	"config_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_elevenlabs_agent_id_unique" UNIQUE("elevenlabs_agent_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"elevenlabs_conversation_id" text NOT NULL,
	"agent_id" text,
	"channel" text DEFAULT 'web' NOT NULL,
	"user_id" text,
	"status" text,
	"cost_microcredits" numeric,
	"cost_usd" numeric,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"transcript_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_elevenlabs_conversation_id_unique" UNIQUE("elevenlabs_conversation_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"conversation_id" text,
	"agent_id" text,
	"channel" text,
	"event_type" text NOT NULL,
	"payload_json" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" serial NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"secret_hash" text,
	"branding" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" serial NOT NULL,
	"agent_id" text,
	"tool_name" text NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"request_json" jsonb,
	"response_json" jsonb,
	"ok" boolean DEFAULT true NOT NULL,
	"latency_ms" integer,
	"error_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_agent_idx" ON "agents" USING btree ("tenant_id","elevenlabs_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_convid_idx" ON "conversations" USING btree ("elevenlabs_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_conv_idx" ON "conversations" USING btree ("tenant_id","elevenlabs_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_tenant_type_idx" ON "events" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_calls_tenant_idx" ON "tool_calls" USING btree ("tenant_id","tool_name");