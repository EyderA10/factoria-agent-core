import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Schema operativo de FactorIA Agent Core (persistencia multi-tenant).
 * La configuración declarativa de cada tenant vive en config/tenants/<id>.json
 * (fuente de verdad). Estas tablas materializan estado y registran la operativa.
 */

export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    configVersion: integer("config_version").notNull().default(1),
    secretHash: text("secret_hash").unique(),
    branding: jsonb("branding").$type<{
      primaryColor?: string;
      title?: string;
      tagline?: string;
    }>(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)]
);

export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    elevenlabsAgentId: text("elevenlabs_agent_id").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("provisioned"),
    configJson: jsonb("config_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agents_tenant_agent_idx").on(t.tenantId, t.elevenlabsAgentId)]
);

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    elevenlabsConversationId: text("elevenlabs_conversation_id").notNull().unique(),
    agentId: text("agent_id"),
    channel: text("channel").notNull().default("web"),
    userId: text("user_id"),
    status: text("status"),
    costMicrocredits: numeric("cost_microcredits"),
    costUsd: numeric("cost_usd"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    transcriptJson: jsonb("transcript_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_convid_idx").on(t.elevenlabsConversationId),
    uniqueIndex("conversations_tenant_conv_idx").on(t.tenantId, t.elevenlabsConversationId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)]
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agentId: text("agent_id"),
    toolName: text("tool_name").notNull(),
    channel: text("channel").notNull().default("web"),
    requestJson: jsonb("request_json"),
    responseJson: jsonb("response_json"),
    ok: boolean("ok").notNull().default(true),
    latencyMs: integer("latency_ms"),
    errorJson: jsonb("error_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tool_calls_tenant_idx").on(t.tenantId, t.toolName)]
);

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    agentId: text("agent_id"),
    channel: text("channel"),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_tenant_type_idx").on(t.tenantId, t.eventType)]
);

export type TenantRow = typeof tenants.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type EventRow = typeof events.$inferSelect;