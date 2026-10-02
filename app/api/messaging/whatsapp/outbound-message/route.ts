import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { elevenLabsErrorMessage, getElevenLabsClient, hasElevenLabsApiKey, resolveAgentIdForTenant } from "@/lib/elevenlabs";
import { resolveTenantFromAuth } from "@/lib/tenants/resolver";
import { loadTenantConfig } from "@/lib/tenants/store";
import { DEFAULT_RULES, postgresRateLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * El consumidor nombra el DESTINO y la CLAVE de plantilla; el nombre real de la
 * plantilla y su idioma salen de `whatsapp.templates` en el config del tenant.
 * El destino se valida como E.164 para no poder pasar arbitrario a la API.
 *
 * `params`es dinámico (nombre, fecha, pedido) porque las plantillas de Meta
 * llevan placeholders `{{1}}`, `{{2}}` que se rellenan en orden.
 */
const OutboundMessageSchema = z.object({
  toNumber: z
    .string()
    .regex(
      /^\+?[1-9]\d{7,14}$/,
      "debe estar en E.164 con código de país, con o sin '+': 573001234567"
    ),
  template: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "debe ser una clave de plantilla del tenant, p.ej. confirmacion"),
  params: z.array(z.string().max(1024)).max(20).default([]),
});

/**
 * WhatsApp outbound: FactorIA → API ElevenLabs → WABA de Meta → destino.
 *
 * AISLAMIENTO MULTI-TENANT: El tenant se resuelve por
 * el secret Bearer, el `agentId` se busca en DB para ese tenant, el número saliente se
 * lee de `whatsapp.phoneNumberId` y la plantilla se busca en `whatsapp.templates` por
 * clave. El consumidor elige a quién escribir y con qué datos; nunca desde qué agente,
 * desde qué número ni con qué plantilla.
 *
 * `template` es obligatoria a propósito: si quien llama manda `templateName` (el nombre
 * de Meta) en vez de la clave, la clave no está y la petición falla con 400 en vez de
 * enviar en silencio una plantilla que no era la pretendida.
 *
 */
export async function POST(req: NextRequest) {
  if (!hasElevenLabsApiKey()) {
    return NextResponse.json(
      {
        error: "not_configured",
        hint: "Configura ELEVENLABS_API_KEY. Para WhatsApp necesitas además una WABA de Meta vinculada al agente en ElevenLabs.",
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

  const phoneNumberId = config.whatsapp?.phoneNumberId;
  if (!phoneNumberId) {
    return NextResponse.json(
      {
        error: "whatsapp_not_configured",
        hint: "El tenant no declara whatsapp.phoneNumberId en config/tenants/<id>.json.",
      },
      { status: 503 }
    );
  }

  const parsed = OutboundMessageSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const { toNumber, template: templateKey, params } = parsed.data;

  // El `whatsapp_user_id` de ElevenLabs es solo dígitos con código de país, sin `+`.
  // Aceptamos las dos formas porque E.164 con `+` es lo que suelen tener los
  // consumidores, pero el `+` nunca debe llegar a la API.
  const whatsappUserId = toNumber.replace(/^\+/, "");

  const template = config.whatsapp?.templates?.[templateKey];
  if (!template) {
    return NextResponse.json(
      {
        error: "unknown_template",
        reason: `El tenant ${tenant.tenantId} no declara la plantilla "${templateKey}"`,
        availableTemplates: Object.keys(config.whatsapp?.templates ?? {}),
      },
      { status: 400 }
    );
  }

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
          hint: `El tenant no tiene agente provisionado. Usa \`npm run setup -- --tenant <id>\`.`,
        },
        { status: 503 }
      );
    }

    console.log(
      `[FactorIA] whatsapp outbound-message tenant=${tenant.tenantId} agent=${agentId} to=${toNumber} template=${templateKey}`
    );

    const response = await getElevenLabsClient().conversationalAi.whatsapp.outboundMessage({
      agentId,
      whatsappPhoneNumberId: phoneNumberId,
      whatsappUserId,
      templateName: template.name,
      templateLanguageCode: template.languageCode,
      templateParams:
        params.length > 0
          ? [{ type: "body" as const, parameters: params.map((text) => ({ text })) }]
          : [],
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

    const message = elevenLabsErrorMessage(error, "whatsapp_outbound_message_failed");
    console.error(`[whatsapp] error tenant=${tenant.tenantId}:`, message);

    return NextResponse.json({ error: message }, { status: 502 });
  }
}