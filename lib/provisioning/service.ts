import { randomBytes } from "node:crypto";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { loadTenantConfig } from "@/lib/tenants/store";
import { hashSecret } from "@/lib/tenants/resolver";
import { getElevenLabsClient, hasElevenLabsApiKey } from "@/lib/elevenlabs";
import { toolHandlers } from "@/lib/tools";
import { upsertTenant, upsertAgent, setTenantSecretHash, getTenantById } from "@/lib/db/repo";
import type { TenantConfig, ToolConfig } from "@/lib/tenants/model";

/**
 * Servicio de provisioning (desacoplado de la CLI).
 *
 * Flujo: config del tenant (source of truth) → este servicio → estado en DB +
 * recursos en ElevenLabs (secret → tools → agente). Reutilizable por la CLI hoy
 * y por un futuro panel web sin tocar el core.
 *
 * Operaciones: validate / diff / provision (idempotente, --update-fuerza).
 */

const REST_BASE = "https://api.elevenlabs.io";

export type PlanItem = { action: "create" | "update" | "reuse"; kind: string; name: string; note?: string };

export interface DiffResult {
  tenantId: string;
  plan: PlanItem[];
  secret: { name: string; existing: boolean };
}

export interface ProvisionResult extends DiffResult {
  agentId: string;
  toolIds: string[];
  /** Nombre de la env var donde el operador debe guardar el secret (config.auth.secretRef). */
  secretRef: string;
  generatedSecret?: string;
}

function resolveBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_FACTORIA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function secretValue(tenant: TenantConfig): string | undefined {
  return tenant.auth.secretRef ? process.env[tenant.auth.secretRef] : undefined;
}

function generateSecret(): string {
  return randomBytes(24).toString("hex");
}

// ---------------------------------------------------------------------------
// ElevenLabs helpers (SDK + REST) — el SDK donde alcanza, REST donde el enum no llega
// ---------------------------------------------------------------------------

async function elevenlabsRest(method: string, path: string, body: unknown) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const res = await fetch(`${REST_BASE}${path}`, {
    method,
    headers: { "xi-api-key": apiKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    throw new Error(`ElevenLabs REST ${method} ${path} → ${res.status}: ${JSON.stringify(detail)}`);
  }
  return JSON.parse(text || "{}");
}

async function findWebhookTools(client: ElevenLabsClient): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversationalAi.tools.list({ pageSize: 100, cursor, types: "webhook" });
    for (const t of res.tools) {
      const name = (t.toolConfig as { name?: string }).name ?? "";
      out.push({ id: t.id, name });
    }
    cursor = res.nextCursor;
    if (!res.hasMore) break;
  } while (cursor);
  return out;
}

async function findAgents(client: ElevenLabsClient): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversationalAi.agents.list({ pageSize: 100, cursor });
    for (const a of res.agents) out.push({ id: a.agentId, name: a.name });
    cursor = res.nextCursor;
    if (!res.hasMore) break;
  } while (cursor);
  return out;
}

/**
 * Garantiza que el secret store del workspace tenga el valor del tenant.
 *
 * El valor de un secret de ElevenLabs no es legible por API, así que el hash guardado
 * en la tabla `tenants` es lo que dice si el store está sincronizado: si coincide, no
 * se toca nada (y el secret no se vuelve a imprimir); si no, se actualiza el selector
 * y se re-sincroniza el hash. Sin esto, rotar el secret dejaría al agente con el
 * valor viejo y el dispatcher le respondería 401.
 */
async function ensureWorkspaceSecret(
  client: ElevenLabsClient,
  name: string,
  value: string,
  alreadySynced: boolean
): Promise<{ secretId: string; created: boolean; updated: boolean }> {
  const list = await client.conversationalAi.secrets.list();
  const existing = list.secrets.find((s) => s.name === name);
  if (!existing) {
    const created = await client.conversationalAi.secrets.create({ name, value });
    return { secretId: created.secretId, created: true, updated: false };
  }
  if (alreadySynced) {
    return { secretId: existing.secretId, created: false, updated: false };
  }
  await client.conversationalAi.secrets.update(existing.secretId, { name, value });
  return { secretId: existing.secretId, created: false, updated: true };
}

function buildRestConfig(tenant: TenantConfig, toolIds: string[]) {
  return {
    text_only: false,
    conversation: {
      client_events: [
        "user_transcript",
        "tentative_user_transcript",
        "agent_response",
        "agent_response_complete",
        "agent_chat_response_part",
      ],
    },
    turn: { turn_timeout: 30 },
    agent: {
      first_message: tenant.agent.firstMessage,
      language: tenant.agent.language,
      prompt: {
        prompt: tenant.agent.systemPrompt,
        llm: tenant.agent.llm,
        timezone: tenant.agent.timezone,
        tool_ids: toolIds,
      },
    },
    tts: { model_id: tenant.agent.ttsModel },
  };
}

function webhookToolApiSchema(tool: ToolConfig, url: string, secretId: string) {
  return {
    url,
    method: "POST" as const,
    contentType: "application/json" as const,
    requestHeaders: { Authorization: { secretId } },
    requestBodySchema: {
      type: "object" as const,
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
    responseTimeoutSecs: 30,
    interruptionMode: "disable_during_tool_and_turn" as const,
  };
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

export function validateTenant(tenantId: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let tenant: TenantConfig;
  try {
    tenant = loadTenantConfig(tenantId);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }

  if (!tenant.tools.length) errors.push("El tenant no define tools");
  for (const tool of tenant.tools) {
    if (!toolHandlers[tool.name]) {
      errors.push(`La tool "${tool.name}" no tiene handler en el core (lib/tools).`);
    }
    if (!tool.inputSchema || Object.keys(tool.inputSchema.properties ?? {}).length === 0) {
      errors.push(`La tool "${tool.name}" no define properties en inputSchema.`);
    }
  }
  if (!hasElevenLabsApiKey()) errors.push("ELEVENLABS_API_KEY no está definida (env).");

  return { ok: errors.length === 0, errors };
}

export async function diffTenant(tenantId: string): Promise<DiffResult> {
  const tenant = loadTenantConfig(tenantId);
  const plan: PlanItem[] = [];
  const client = getElevenLabsClient();

  // Secret
  const secretName = `FACTORIA_${tenant.slug.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOOL`;
  const existingSecrets = await client.conversationalAi.secrets.list();
  const secretExists = existingSecrets.secrets.some((s) => s.name === secretName);
  plan.push({ action: secretExists ? "reuse" : "create", kind: "secret", name: secretName });

  // Tools
  const existingTools = await findWebhookTools(client);
  for (const tool of tenant.tools) {
    const found = existingTools.find((t) => t.name === tool.name);
    plan.push({
      action: found ? "reuse" : "create",
      kind: "tool",
      name: tool.name,
      note: found ? `id ${found.id}` : `${resolveBaseUrl()}/api/tools/${tool.name}`,
    });
  }

  // Agent
  const existingAgents = await findAgents(client);
  const agentFound = existingAgents.find((a) => a.name === tenant.agent.name);
  plan.push({
    action: agentFound ? "reuse" : "create",
    kind: "agent",
    name: tenant.agent.name,
    note: agentFound ? `id ${agentFound.id}` : "crea con prompt + tools del tenant",
  });

  return { tenantId, plan, secret: { name: secretName, existing: secretExists } };
}

export async function provisionTenant(
  tenantId: string,
  opts: { dryRun?: boolean; forceUpdateTool?: boolean; forceUpdateAgent?: boolean; rotateSecret?: boolean } = {}
): Promise<ProvisionResult> {
  const tenant = loadTenantConfig(tenantId);
  const dryRun = Boolean(opts.dryRun);
  const client = getElevenLabsClient();
  const baseUrl = resolveBaseUrl();

  const secretName = `FACTORIA_${tenant.slug.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOOL`;

  // --- Secret del tenant (nunca en el repo) ---
  const secret = opts.rotateSecret ? generateSecret() : secretValue(tenant) ?? generateSecret();
  const secretHash = hashSecret(secret);
  const plan: PlanItem[] = [];
  let secretId = "";
  let secretChanged = false;

  if (dryRun) {
    secretId = `(secret selector: ${secretName})`;
    plan.push({ action: "reuse", kind: "secret", name: secretName, note: "dry-run" });
  } else {
    const tenantRow = await getTenantById(tenantId);
    const alreadySynced = !opts.rotateSecret && tenantRow?.secretHash === secretHash;
    const ensured = await ensureWorkspaceSecret(client, secretName, `Bearer ${secret}`, alreadySynced);
    secretId = ensured.secretId;
    secretChanged = ensured.created || ensured.updated;
    plan.push(
      ensured.created
        ? { action: "create", kind: "secret", name: secretName, note: "selector nuevo" }
        : alreadySynced
          ? { action: "reuse", kind: "secret", name: secretName, note: "valor ya sincronizado" }
          : { action: "update", kind: "secret", name: secretName, note: "valor sincronizado con la DB" }
    );
  }

  // --- Tools webhook (una por tool del tenant) ---
  const toolIds: string[] = [];
  const existingTools = dryRun ? [] : await findWebhookTools(client);
  for (const tool of tenant.tools) {
    const url = `${baseUrl}/api/tools/${tool.name}`;
    const existing = dryRun ? undefined : existingTools.find((t) => t.name === tool.name);

    if (existing && opts.forceUpdateTool) {
      await elevenlabsRest("PATCH", `/v1/convai/tools/${existing.id}`, {
        tool_config: {
          type: "webhook",
          name: tool.name,
          description: tool.description,
          api_schema: {
            url,
            method: "POST",
            content_type: "application/json",
            request_headers: { Authorization: { secret_id: secretId } },
            request_body_schema: { type: "object", properties: tool.inputSchema.properties, required: tool.inputSchema.required },
            response_timeout_secs: 30,
            interruption_mode: "disable_during_tool_and_turn",
          },
        },
      });
      toolIds.push(existing.id);
      plan.push({ action: "update", kind: "tool", name: tool.name, note: `id ${existing.id}` });
    } else if (existing) {
      toolIds.push(existing.id);
      plan.push({ action: "reuse", kind: "tool", name: tool.name, note: `id ${existing.id}` });
    } else {
      if (dryRun) {
        toolIds.push(`(nuevo: ${tool.name})`);
        plan.push({ action: "create", kind: "tool", name: tool.name, note: url });
        continue;
      }
      const created = await client.conversationalAi.tools.create({
        toolConfig: {
          type: "webhook",
          name: tool.name,
          description: tool.description,
          apiSchema: webhookToolApiSchema(tool, url, secretId),
        },
      });
      toolIds.push(created.id);
      plan.push({ action: "create", kind: "tool", name: tool.name, note: `id ${created.id}` });
    }
  }

  // --- Agente (REST: los modelos TTS v2.5 no están en el enum del SDK) ---
  let agentId = "";
  const agentName = tenant.agent.name;
  const existingAgents = dryRun ? [] : await findAgents(client);
  const existingAgent = dryRun ? undefined : existingAgents.find((a) => a.name === agentName);
  const conversationConfig = buildRestConfig(tenant, toolIds);

  if (existingAgent && opts.forceUpdateAgent) {
    await elevenlabsRest("PATCH", `/v1/convai/agents/${existingAgent.id}`, { conversation_config: conversationConfig });
    agentId = existingAgent.id;
    plan.push({ action: "update", kind: "agent", name: agentName, note: `id ${agentId}` });
  } else if (existingAgent) {
    agentId = existingAgent.id;
    plan.push({ action: "reuse", kind: "agent", name: agentName, note: `id ${agentId}` });
  } else if (dryRun) {
    agentId = "(nuevo agente)";
    plan.push({ action: "create", kind: "agent", name: agentName });
  } else {
    const created = await elevenlabsRest("POST", "/v1/convai/agents/create", { name: agentName, conversation_config: conversationConfig });
    agentId = created.agent_id;
    plan.push({ action: "create", kind: "agent", name: agentName, note: `id ${agentId}` });
  }

  // --- Estado materializado en DB ---
  if (!dryRun) {
    await upsertTenant(tenant, /* configVersion */ 1);
    // El hash en DB siempre refleja el valor que acabamos de sincronizar en el store.
    await setTenantSecretHash(tenantId, secretHash);
    await upsertAgent({
      tenantId,
      elevenlabsAgentId: agentId,
      name: agentName,
      configJson: { tools: tenant.tools.map((t) => t.name), version: 1 },
    });
  } else {
    plan.push({ action: "create", kind: "tenant_row", name: tenantId });
    plan.push({ action: "create", kind: "secret_hash", name: tenantId });
  }

  const result: ProvisionResult = {
    tenantId,
    plan,
    secret: { name: secretName, existing: !secretChanged },
    agentId,
    toolIds,
    secretRef: tenant.auth.secretRef,
  };
  if (secretChanged) {
    result.generatedSecret = secret;
  }
  return result;
}