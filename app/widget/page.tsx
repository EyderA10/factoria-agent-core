import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";
import { resolveAgentIdForTenant } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

/** Índice de widgets por tenant: cada cliente pega /widget/<id> en su web. */
export default async function WidgetIndexPage() {
  const ids = listTenantIds();
  const tenants = await Promise.all(
    ids.map(async (id) => {
      const cfg = loadTenantConfig(id);
      const agentId = await resolveAgentIdForTenant(cfg.id);
      return { cfg, agentId: agentId ?? null };
    })
  );

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-6">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-slate-100">Widgets por tenant</h1>
          <p className="mt-2 text-sm text-slate-400">
            Un mismo componente white-label (<code className="font-mono text-emerald-400">/widget/&lt;tenant&gt;</code>)
            con el branding y el agente de cada cliente. El cliente solo pega el id de su tenant.
          </p>
        </header>

        <ul className="space-y-3">
          {tenants.map(({ cfg, agentId }) => (
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
              <div className="flex items-center gap-2">
                <a
                  href={`/widget/${cfg.id}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: cfg.branding.primaryColor }}
                >
                  Abrir widget
                </a>
                <code className="font-mono text-[10px] text-slate-500">
                  {agentId ? "agente OK" : "sin agente (provisionar)"}
                </code>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-center text-xs text-slate-500">
          Config pública para embeber: <code className="font-mono text-emerald-400">/api/widget/config?tenant=&lt;id&gt;</code>
        </p>
      </div>
    </main>
  );
}