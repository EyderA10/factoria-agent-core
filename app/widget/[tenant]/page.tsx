import { notFound } from "next/navigation";
import { FactorIAChatWidget } from "@/components/factoria-chat-widget";
import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";
import { resolveAgentIdForTenant } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

/**
 * Widget white-label por tenant: /widget/<id>
 * (ej: /widget/mesa-y-cia, /widget/vitea)
 *
 * El cliente pega un <iframe>/script con su id; el tenant define nombre, tagline,
 * color e ícono en config/tenants/<id>.json. /widget sin id muestra el índice.
 */
export default async function TenantWidgetPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantId } = await params;
  const ids = listTenantIds();
  if (!ids.includes(tenantId)) notFound();

  const tenant = loadTenantConfig(tenantId);
  if (!tenant.enabled) notFound();

  const agentId = await resolveAgentIdForTenant(tenant.id);
  const { title, tagline, primaryColor, icon } = tenant.branding;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-6"
      style={{ background: `linear-gradient(160deg, ${primaryColor}22, #020617 55%)` }}
    >
      <div className="max-w-md text-center">
        <div className="text-4xl">{icon}</div>
        <h1 className="mt-3 text-2xl font-bold text-slate-100">{title}</h1>
        {tagline && <p className="mt-1 text-sm text-slate-400">{tagline}</p>}
        <p className="mt-4 text-xs text-slate-500">
          Widget white-label servido por FactorIA Agent Core. Escribe o haz clic en «Iniciar conversación».
        </p>
      </div>

      <FactorIAChatWidget
        tenantId={tenant.id}
        agentId={agentId ?? undefined}
        title={title}
        primaryColor={primaryColor}
        icon={icon}
      />
    </main>
  );
}
