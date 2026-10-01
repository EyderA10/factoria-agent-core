import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { elevenLabsErrorMessage, getElevenLabsClient, hasElevenLabsApiKey, resolveAgentIdForTenant } from "@/lib/elevenlabs";
import { resolveTenantFromAuth } from "@/lib/tenants/resolver";
import { loadTenantConfig } from "@/lib/tenants/store";
import { DEFAULT_RULES, postgresRateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El destino sí lo elige el consumidor (es el propósito del endpoint), pero se valida
 * como E.164 para no poder pasar arbitrario a la API de telefonía.
 */
const OutboundCallSchema = z.object({
  toNumber: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "debe estar en formato E.164, p.ej. +573001234567"),
});

/**
 * Telefonía outbound: FactorIA → API ElevenLabs → Twilio → destino.
 *
 * AISLAMIENTO MULTI-TENANT: ni `agentId` ni el número salen del cuerpo de la petición.
 * El tenant se resuelve por el secret Bearer (el mismo mecanismo del dispatcher de
 * tools), el `agentId` se busca en DB para ese tenant y el número se lee de
 * `telephony.agentPhoneNumberId` en el config. El consumidor solo elige a quién
 * llamar; nunca desde qué agente ni desde qué número.
 */
export async function POST(req: NextRequest) {
  if (!hasElevenLabsApiKey()) {
    return NextResponse.json(
      {
        error: "not_configured",
        hint: "Configura ELEVENLABS_API_KEY. Para outbound necesitas además un número Twilio importado en ElevenLabs (Phone Numbers).",
      },
      { status: 503 }
    );
  }

  const tenant = await resolveTenantFromAuth(req.headers.get("authorization"));
  if (!tenant) {
    return NextResponse.json({ error: "Unauthorized: invalid FactorIA Tenant Secret" }, { status: 401 });
  }
  if (!tenant.enabled) {
    return NextResponse.json({ error: "Tenant deshabilitado" }, { status: 403 });
  }

  let config;
  try {
    config = loadTenantConfig(tenant.tenantId);
  } catch {
    return NextResponse.json({ error: "unknown_tenant", reason: "config no disponible" }, { status: 404 });
  }

  const phoneNumberId = config.telephony?.agentPhoneNumberId;
  if (!phoneNumberId) {
    return NextResponse.json(
      {
        error: "telephony_not_configured",
        hint: "El tenant no declara telephony.agentPhoneNumberId en config/tenants/<id>.json.",
      },
      { status: 503 }
    );
  }

  const parsed = OutboundCallSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const { toNumber } = parsed.data;

  const limit = await postgresRateLimiter.hit("tenant", tenant.tenantId, DEFAULT_RULES.outboundPerTenant);
  if (limit.blocked) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfterSeconds: limit.retryAfterSeconds,
        limit: limit.limit,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const agentId = await resolveAgentIdForTenant(tenant.tenantId);
    if (!agentId) {
      return NextResponse.json(
        {
          error: "not_configured",
          hint: "El tenant no tiene agente provisionado. Usa `npm run setup -- --tenant <id>`.",
        },
        { status: 503 }
      );
    }

    console.log(`[FactorIA] outbound call tenant=${tenant.tenantId} agent=${agentId} to=${toNumber}`);

    const response = await getElevenLabsClient().conversationalAi.twilio.outboundCall({
      agentId,
      agentPhoneNumberId: phoneNumberId,
      toNumber,
    });

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    // `agent_id_required` lo lanza el propio core (no hay agente en DB), no ElevenLabs.
    if (error instanceof Error && error.message === "agent_id_required") {
      return NextResponse.json(
        {
          error: "not_configured",
          hint: `El tenant ${tenant.tenantId} no tiene agente provisionado. Usa \`npm run setup -- --tenant ${tenant.tenantId}\`.`,
        },
        { status: 503 }
      );
    }

    const message = elevenLabsErrorMessage(error, "outbound_call_failed");
    console.error(`[outbound] error tenant=${tenant.tenantId}:`, message);

    return NextResponse.json({ error: message }, { status: 502 });
  }
}