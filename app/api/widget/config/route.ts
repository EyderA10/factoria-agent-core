import { NextRequest, NextResponse } from "next/server";
import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Config PÚBLICA del widget de un tenant (white-label).
 * Solo branding + primeras líneas: nunca secretos, prompts ni reglas de negocio.
 *
 * NO se expone `agentId`. El widget obtiene la sesión por
 * `/api/elevenlabs/session?tenant=<id>`, que devuelve un signed URL; publicar el id
 * del agente allowlistado convertiría este endpoint en una forma de enumerar los
 * agentes del workspace de ElevenLabs.
 *
 * El listado de tenants sin `?tenant` está deshabilitado en producción: publicar el
 * roster de clientes de FactorIA a cualquiera que llegue a la URL no aporta nada al
 * embedder y filtra datos de otros clientes.
 *
 * GET /api/widget/config?tenant=vitea
 */
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant");

  if (!tenantId) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error: "tenant_required",
          hint: "Pasa ?tenant=<id>. El índice de tenants no está disponible en producción.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({
      tenants: listTenantIds().map((id) => {
        const cfg = loadTenantConfig(id);
        return { id: cfg.id, name: cfg.name, branding: cfg.branding };
      }),
    });
  }

  let tenant;
  try {
    tenant = loadTenantConfig(tenantId);
  } catch {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
  }

  if (!tenant.enabled) {
    return NextResponse.json({ error: "tenant_disabled" }, { status: 403 });
  }

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
    },
    branding: tenant.branding,
    firstMessage: tenant.agent.firstMessage,
    tools: tenant.tools.map((t) => ({ name: t.name, description: t.description })),
  });
}