import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

/**
 * Utilidades server-side de ElevenLabs.
 * IMPORTANTE: este módulo solo debe importarse desde Server Components / API Routes.
 * Nunca exponga ELEVENLABS_API_KEY al navegador.
 */

export function hasElevenLabsApiKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function getElevenLabsClient(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY no está configurada. Cópiala desde ElevenLabs → Dashboard → API Keys");
  }
  return new ElevenLabsClient({ apiKey });
}

export interface SessionForAgent {
  mode: "public_agent" | "signed_url";
  agentId?: string;
  signedUrl?: string;
}

/**
 * Resuelve el Agent ID de un tenant: el materializado en DB (provisioning) es la
 * ÚNICA fuente de verdad. Sin tenant provisionado no hay agente — no hay fallback
 * global: un agente "por defecto" escondería fallos de provisioning.
 */
export async function resolveAgentIdForTenant(tenantId?: string | null): Promise<string | undefined> {
  if (!tenantId) return undefined;
  const { getAgentForTenant } = await import("@/lib/db/repo");
  const agent = await getAgentForTenant(tenantId);
  return agent?.elevenlabsAgentId ?? undefined;
}

/**
 * Genera un signed URL (agentes privados) o devuelve el agentId (agentes públicos).
 *
 * El agente se resuelve SIEMPRE a partir del tenant, en el servidor: el endpoint no
 * acepta un agentId del cliente, para que el navegador no pueda pedir una sesión de
 * cualquier agente del workspace saltándose el aislamiento por tenant.
 */
export async function sessionForAgent(tenantId?: string | null): Promise<SessionForAgent> {
  const agentId = await resolveAgentIdForTenant(tenantId);
  if (!agentId) {
    throw new Error("agent_id_required");
  }

  if (!hasElevenLabsApiKey()) {
    return { mode: "public_agent", agentId };
  }

  const response = await getElevenLabsClient().conversationalAi.conversations.getSignedUrl({
    agentId,
    includeConversationId: true,
  });

  return { mode: "signed_url", signedUrl: response.signedUrl };
}