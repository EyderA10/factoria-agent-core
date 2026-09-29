import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "./client";
import {
  agents,
  conversations,
  events,
  messages,
  tenants,
  toolCalls,
  type ToolCallRow,
} from "./schema";
import type { Branding, TenantConfig } from "@/lib/tenants/model";

/**
 * Capa de persistencia operativa (Supabase Postgres).
 *
 * Es el "puerto" de la app: TODO acceso a DB pasa por aquí. Si en una fase futura
 * se añade Upstash Redis (cache de sesión/contexto) o Langfuse (tracing), estos
 * wrappers son el punto de extensión sin tocar los handlers.
 */

// ---- tenants ----

export async function upsertTenant(cfg: Pick<TenantConfig, "id" | "slug" | "name" | "enabled" | "branding">, configVersion: number) {
  const branding: Branding | undefined = cfg.branding;
  return db
    .insert(tenants)
    .values({
      id: cfg.id,
      slug: cfg.slug,
      name: cfg.name,
      enabled: cfg.enabled,
      configVersion,
      branding,
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: {
        slug: cfg.slug,
        name: cfg.name,
        enabled: cfg.enabled,
        configVersion,
        branding,
        updatedAt: new Date(),
      },
    })
    .returning();
}

export async function getTenantById(id: string) {
  return db.select().from(tenants).where(eq(tenants.id, id)).limit(1).then((r) => r[0] ?? null);
}

export async function getTenantsForAuth(): Promise<{ id: string; secretHash: string | null; enabled: boolean }[]> {
  return db
    .select({ id: tenants.id, secretHash: tenants.secretHash, enabled: tenants.enabled })
    .from(tenants)
    .where(isNotNull(tenants.secretHash));
}

export async function setTenantSecretHash(id: string, secretHash: string) {
  await db.update(tenants).set({ secretHash, updatedAt: new Date() }).where(eq(tenants.id, id));
}

// ---- agents ----

export async function upsertAgent(params: {
  tenantId: string;
  elevenlabsAgentId: string;
  name: string;
  configJson?: Record<string, unknown>;
}) {
  return db
    .insert(agents)
    .values({
      tenantId: params.tenantId,
      elevenlabsAgentId: params.elevenlabsAgentId,
      name: params.name,
      configJson: params.configJson,
    })
    .onConflictDoUpdate({
      target: agents.elevenlabsAgentId,
      set: {
        tenantId: params.tenantId,
        name: params.name,
        configJson: params.configJson,
        status: "provisioned",
        updatedAt: new Date(),
      },
    })
    .returning();
}

export async function getAgentForTenant(tenantId: string) {
  return db
    .select()
    .from(agents)
    .where(eq(agents.tenantId, tenantId))
    .orderBy(desc(agents.updatedAt))
    .limit(1)
    .then((r) => r[0] ?? null);
}

export async function getAgentByElevenlabsId(elevenlabsAgentId: string) {
  return db
    .select()
    .from(agents)
    .where(eq(agents.elevenlabsAgentId, elevenlabsAgentId))
    .limit(1)
    .then((r) => r[0] ?? null);
}

// ---- conversations ----

export async function createConversation(params: {
  tenantId: string;
  convId: string;
  agentId?: string | null;
  channel: string;
  userId?: string | null;
  status?: string | null;
}) {
  return db
    .insert(conversations)
    .values({
      tenantId: params.tenantId,
      elevenlabsConversationId: params.convId,
      agentId: params.agentId,
      channel: params.channel,
      userId: params.userId,
      status: params.status,
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: conversations.elevenlabsConversationId })
    .returning();
}

export async function getConversationByConvId(convId: string) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.elevenlabsConversationId, convId))
    .limit(1)
    .then((r) => r[0] ?? null);
}

export async function updateConversation(
  convId: string,
  patch: Partial<{
    status: string | null;
    costMicrocredits: string | null;
    costUsd: string | null;
    endedAt: Date | null;
    transcriptJson: unknown;
    channel: string;
  }>
) {
  await db.update(conversations).set({ ...patch, updatedAt: new Date() }).where(eq(conversations.elevenlabsConversationId, convId));
}

export async function insertMessages(rows: { convRowId: number; role: string; text: string }[]) {
  if (rows.length === 0) return;
  await db.insert(messages).values(
    rows.map((r) => ({
      conversationId: r.convRowId,
      role: r.role,
      text: r.text,
    }))
  );
}

// ---- tool calls ----

export async function insertToolCall(params: {
  tenantId: string;
  conversationRowId?: number | null;
  agentId?: string | null;
  toolName: string;
  channel?: string;
  requestJson: unknown;
  responseJson?: unknown;
  ok: boolean;
  latencyMs?: number;
  errorJson?: unknown;
}) {
  return db.insert(toolCalls).values({
    tenantId: params.tenantId,
    conversationId: params.conversationRowId ?? undefined,
    agentId: params.agentId,
    toolName: params.toolName,
    channel: params.channel ?? "web",
    requestJson: params.requestJson,
    responseJson: params.responseJson,
    ok: params.ok,
    latencyMs: params.latencyMs,
    errorJson: params.errorJson,
  }).returning();
}

// ---- events (observabilidad: webhooks post-call, errores, costes) ----

export async function insertEvent(params: {
  tenantId?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  channel?: string | null;
  eventType: string;
  payloadJson: unknown;
}) {
  return db.insert(events).values({
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    agentId: params.agentId,
    channel: params.channel,
    eventType: params.eventType,
    payloadJson: params.payloadJson,
  }).returning();
}

// ---- lecturas scoped por tenant (entregable: consultar conversaciones/logs) ----

export async function listConversationsByTenant(tenantId: string, limit = 50) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);
}

export async function listToolCallsByTenant(tenantId: string, limit = 100) {
  return db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.tenantId, tenantId))
    .orderBy(desc(toolCalls.createdAt))
    .limit(limit);
}

export async function listEventsByTenant(tenantId: string, limit = 100) {
  return db
    .select()
    .from(events)
    .where(eq(events.tenantId, tenantId))
    .orderBy(desc(events.receivedAt))
    .limit(limit);
}

export type { ToolCallRow };