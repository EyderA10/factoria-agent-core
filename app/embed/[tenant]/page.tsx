import { notFound } from "next/navigation";
import { FactorIAEmbedShell } from "@/components/factoria-embed-shell";
import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";

export const dynamic = "force-dynamic";

/**
 * Página que se sirve dentro del iframe que inyecta `public/embed.js`.
 *
 * A diferencia de `/widget/<tenant>`, esta es la que se embebe en la web del
 * cliente: con `frame-ancestors` limitado a los
 * orígenes que el tenant declara. Ese límite se aplica en `proxy.ts`, porque es
 * una cabecera de respuesta y desde la página no se puede fijar.
 *
 * `frame-ancestors` es la lista blanca real: el control es "estas webs pueden
 * embeberme y el resto no". Sin tokens ni IPs.
 */
export default async function TenantEmbedPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantId } = await params;
  const ids = listTenantIds();
  if (!ids.includes(tenantId)) notFound();

  const tenant = loadTenantConfig(tenantId);
  if (!tenant.enabled) notFound();

  const { title, primaryColor, icon } = tenant.branding;

  return (
    <>
      <style>{`html,body{background:transparent!important;margin:0;padding:0;overflow:hidden}
        :root{color-scheme:dark}`}</style>
      <div className="fixed inset-0 flex flex-col items-end justify-end">
        <FactorIAEmbedShell
          tenantId={tenant.id}
          title={title}
          primaryColor={primaryColor}
          icon={icon}
        />
      </div>
    </>
  );
}