import { NextRequest, NextResponse } from "next/server";
import { elevenLabsErrorMessage, sessionForAgent } from "@/lib/elevenlabs";
import { loadTenantConfig } from "@/lib/tenants/store";
import { isOriginAllowed } from "@/lib/tenants/model";
import { DEFAULT_RULES, clientIpFrom, postgresRateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint que el widget FactorIA llama antes de iniciar una conversación.
 * - Con ELEVENLABS_API_KEY → devuelve un signed URL (agente privado, sin exponer la key).
 * - Sin API key pero con agente provisionado → devuelve el agentId.
 * - Sin configuración → 503 con instrucciones para que el widget muestre el estado "no configurado".
 * - Error de ElevenLabs → 502 con el `detail.message` real del proveedor y su
 *   `request_id`. 502 y no 500: el core está vivo, quien falla es la dependencia.
 *
 * El agente se resuelve server-side desde el tenant: el endpoint no acepta agentId
 * del cliente para que nadie pueda pedir una sesión de otro agente del workspace.
 *
 * CONTROLES DE ABUSO. Este endpoint es público,
 * así que está acotado por dos cubos: cuota por tenant (protege nuestro coste) y
 * límite por IP (frena el bucle que agotaría la cuota de un cliente legítimo).
 *
 * GET /api/elevenlabs/session?tenant=vitea
 */
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant") ?? undefined;

  if (!tenantId) {
    return NextResponse.json(
      { error: "not_configured", hint: "Pasa ?tenant=<id>. Crea el agente del tenant con `npm run setup -- --tenant <id>`." },
      { status: 400 }
    );
  }

  let config;
  try {
    config = loadTenantConfig(tenantId);
  } catch {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
  }

  if (!config.enabled) {
    return NextResponse.json({ error: "tenant_disabled" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (!isOriginAllowed(config.allowedOrigins, origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const perIp = await postgresRateLimiter.hit(
    "ip",
    clientIpFrom(req.headers),
    DEFAULT_RULES.sessionPerIp
  );
  if (perIp.blocked) {
    return NextResponse.json(
      { error: "rate_limited", limit: perIp.limit, retryAfterSeconds: perIp.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(perIp.retryAfterSeconds) } }
    );
  }

  const perTenant = await postgresRateLimiter.hit(
    "tenant",
    config.id,
    DEFAULT_RULES.sessionPerTenant
  );
  if (perTenant.blocked) {
    return NextResponse.json(
      { error: "rate_limited", limit: perTenant.limit, retryAfterSeconds: perTenant.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(perTenant.retryAfterSeconds) } }
    );
  }

  try {
    const session = await sessionForAgent(config.id);
    return NextResponse.json(session);
  } catch (error) {
    // `agent_id_required` lo lanza el propio core (no hay agente en DB), no ElevenLabs.
    if (error instanceof Error && error.message === "agent_id_required") {
      return NextResponse.json(
        {
          error: "not_configured",
          hint: `El tenant ${config.id} no tiene agente provisionado. Usa \`npm run setup -- --tenant ${config.id}\`.`,
        },
        { status: 400 }
      );
    }

    const message = elevenLabsErrorMessage(error, "elevenlabs_error");
    console.error(`[session] error tenant=${config.id}:`, message);

    return NextResponse.json({ error: message }, { status: 502 });
  }
}