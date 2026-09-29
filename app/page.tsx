const STEPS = [
  {
    n: "01",
    title: "Canales de entrada",
    body: "Web chat · WhatsApp y llamadas requieren credenciales del cliente. Un solo agente omnicanal por tenant.",
  },
  {
    n: "02",
    title: "ElevenLabs Conversational AI",
    body: "STT + LLM + TTS en una conversación. Webhook Tools con autenticación Bearer por tenant hacia FactorIA.",
  },
  {
    n: "03",
    title: "FactorIA Tool Layer",
    body: "Contratos Zod por tool, auth por tenant, handlers genéricos. Los datos/reglas de negocio viven en config/tenants/*.json.",
  },
  {
    n: "04",
    title: "Sistemas del cliente / fuentes externas",
    body: "el tenant expone sus capacidades como tools reutilizables sin tocar el core.",
  },
];

export default function HomePage() {
  const baseUrl = process.env.NEXT_PUBLIC_FACTORIA_BASE_URL ?? "http://localhost:3000";

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-16">
      <div className="w-full max-w-4xl space-y-12">
        <header className="text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-[11px] text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            FactorIA Agent Core — multi-tenant + Tool Layer + persistencia
          </div>
          <h1 className="bg-linear-to-r from-blue-400 to-indigo-400 bg-clip-text text-4xl py-1 font-extrabold tracking-tight text-transparent">
            FactorIA Agent Core
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            Núcleo reutilizable de agentes:{" "}
            <span className="text-slate-200">Tenant → ElevenLabs (secret por tenant) → FactorIA Tool Layer →</span>{" "}
            sistemas del cliente o fuentes externas.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((step) => (
            <div key={step.n} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-2 font-mono text-[11px] text-blue-400">{step.n}</div>
              <h2 className="text-sm font-semibold text-slate-100">{step.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-left">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Estado del Core</h2>
            <ul className="space-y-2.5 text-xs text-slate-400">
              <li className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  POST /api/tools/[toolName]
                </span>
                Dispatcher multi-tenant: auth Bearer → tenant por hash → Zod → handler.
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  npm run setup -- --tenant {"<"}+{"id>"}
                </span>
                Provisiona secret → tools → agente → estado en DB (idempotente, --diff / --dry-run).
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  config/tenants/*.json
                </span>
                Fuente de verdad por tenant (Zod-validada). Toda regla de negocio vive acá.
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  Supabase + Drizzle
                </span>
                Persistencia operacional: tenants, agentes, conversaciones y tool_calls.
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                  GET /api/elevenlabs/session
                </span>
                Signed URL server-side (sin exponer la API key).
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-left text-xs text-slate-400">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Probar una tool (línea)</h2>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-500">
              curl -X POST {baseUrl}/api/tools/reserve_table
              <br />
              -H &apos;Authorization: Bearer $FACTORIA_MESA_Y_CIA_SECRET&apos;
              <br />
              -H &apos;Content-Type: application/json&apos; \
              <br />
              -d &apos;{`{"date":"2026-10-05","party_size":4}`}&apos;
            </div>
            <p className="mt-3">
              Cada tenant tiene su propio secret (<code className="font-mono text-emerald-400">FACTORIA_*_SECRET</code>),
              su propio set de tools y su propio agente en ElevenLabs. Doc técnica en{" "}
              <code className="font-mono text-emerald-400">docs/</code>.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-left text-xs text-slate-400">
          <h2 className="mb-2 text-sm font-semibold text-slate-100">Widget Chat</h2>
          <p>
            El widget se sirve por tenant en{" "}
            <a className="font-mono text-emerald-400 underline" href="/widget/mesa-y-cia">
              /widget/mesa-y-cia
            </a>{" "}
            y{" "}
            <a className="font-mono text-emerald-400 underline" href="/widget/vitea">
              /widget/vitea
            </a>
            , con el branding propio del cliente (color/ícono) y el agente del tenant.
            <a className="ml-1 font-mono text-emerald-400 underline" href="/widget">
              Ver todos
            </a>
            .
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            Cada widget resuelve su agente en la base de datos (materializado por el
            provisioning), así que no existe un agente global.
          </p>
        </section>
      </div>
    </main>
  );
}
