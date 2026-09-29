import { NextRequest, NextResponse } from "next/server";
import { loadTenantConfig, listTenantIds } from "@/lib/tenants/store";
import { resolveAgentIdForTenant } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Config PÚBLICA del widget de un tenant (white-label).
 * Solo branding + ids + primeras líneas: nunca secretos, prompts ni reglas de negocio.
 *
 * GET /api/widget/config?tenant=vitea
 * GET /api/widget/config           → índice de tenants para el embedder
 */
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant");

  if (!tenantId) {
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

  const agentId = await resolveAgentIdForTenant(tenant.id);

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
    },
    branding: tenant.branding,
    agentId: agentId ?? null,
    firstMessage: tenant.agent.firstMessage,
    tools: tenant.tools.map((t) => ({ name: t.name, description: t.description })),
  });
}