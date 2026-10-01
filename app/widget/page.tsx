import { notFound } from "next/navigation";
import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";

export const dynamic = "force-dynamic";

/**
 * Índice de widgets por tenant. Es una herramienta de desarrollo: en producción
 * publicaría el roster de clientes de FactorIA, así que no se sirve.
 *
 * Cada cliente accede solo a su widget: /widget/<id>.
 */
export default async function WidgetIndexPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const tenants = listTenantIds().map((id) => loadTenantConfig(id));

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-slate-100">Widgets por tenant</h1>
          <p className="mt-2 text-sm text-slate-400">
            Un mismo componente white-label (<code className="font-mono text-emerald-400">/widget/&lt;tenant&gt;</code>)
            con el branding de cada cliente. El cliente solo pega el id de su tenant.
          </p>
        </header>

        <ul className="space-y-3">
          {tenants.map((cfg) => (
            <li
              key={cfg.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{cfg.branding.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-slate-100">{cfg.branding.title}</div>
                  <div className="text-xs text-slate-500">
                    {cfg.branding.tagline} · tools: {cfg.tools.map((t) => t.name).join(", ")}
                  </div>
                </div>
              </div>
              <a
                href={`/widget/${cfg.id}`}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                style={{ background: cfg.branding.primaryColor }}
              >
                Abrir widget
              </a>
            </li>
          ))}
        </ul>

        <p className="text-center text-xs text-slate-500">
          Config pública para embeber:{" "}
          <code className="font-mono text-emerald-400">/api/widget/config?tenant=&lt;id&gt;</code>
        </p>
      </div>
    </main>
  );
}