/**
 * CLI de provisioning de FactorIA Agent Core.
 *
 * Es SOLO una interfaz: la lógica vive en lib/provisioning/service.ts para que un
 * futuro panel web reutilice exactamente lo mismo. La configuración del tenant se
 * persiste como fuente de verdad en config/tenants/<id>.json.
 *
 * Uso:
 *   npm run setup -- --list-clients
 *   npm run setup -- --tenant <id> --validate
 *   npm run setup -- --tenant <id> --diff
 *   npm run setup -- --tenant <id> --dry-run
 *   npm run setup -- --tenant <id>                  (provisiona, idempotente)
 *   npm run setup -- --tenant <id> --force-update   (re-aplica tools + agente)
 *   npm run setup -- --tenant <id> --rotate-secret
 */
import "dotenv/config";
import { resolve } from "node:path";
import { config as loadLocalEnv } from "dotenv";
import { listTenantIds } from "@/lib/tenants/store";
import { validateTenant, diffTenant, provisionTenant } from "@/lib/provisioning/service";
import { hasElevenLabsApiKey } from "@/lib/elevenlabs";

loadLocalEnv({ path: resolve(process.cwd(), ".env.local") });

const USAGE = `
Provisiona ElevenLabs por tenant (secret → tools → agente → estado en DB).
La config vive en config/tenants/<id>.json (fuente de verdad).

  --list-clients        Lista los tenants configurados.
  --tenant ID           Tenant a operar (alias: --client).
  --validate            Valida el config (Zod + handlers) sin tocar nada.
  --diff                Compara ElevenLabs vs config (plan sin ejecutar).
  --dry-run             Muestra que haría sin llamar a la API.
  --force-update        Re-aplica tools (URL/secret selector) + prompt/agente.
  --rotate-secret       Genera un secret nuevo para el tenant.
  --help                Esta ayuda.
`;

function parseArgs(argv: string[]) {
  const opts: Record<string, string | boolean> = { listClients: false, help: false, validate: false, diff: false, dryRun: false, forceUpdate: false, rotateSecret: false };
  let pending: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      pending = null;
      const eq = arg.indexOf("=");
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const value = eq === -1 ? "" : arg.slice(eq + 1);
      switch (key) {
        case "list-clients": opts.listClients = true; break;
        case "validate": opts.validate = true; break;
        case "diff": opts.diff = true; break;
        case "dry-run": opts.dryRun = true; break;
        case "force-update": opts.forceUpdate = true; break;
        case "rotate-secret": opts.rotateSecret = true; break;
        case "help": opts.help = true; break;
        case "tenant":
        case "client":
          opts.tenant = value || "";
          if (!value) pending = "tenant";
          break;
        default: break;
      }
    } else if (pending) {
      opts[pending] = arg;
      pending = null;
    }
  }
  return opts;
}

function box(title: string, lines: (string | undefined)[]) {
  const clean = lines.filter((l) => l !== undefined) as string[];
  const width = Math.max(title.length, ...clean.map((l) => l.length)) + 4;
  console.log(`\n${"─".repeat(width)}`);
  console.log(`  ${title}`);
  console.log(`─`.repeat(width));
  for (const l of clean) console.log(`  ${l}`);
  console.log();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.listClients) {
    const ids = listTenantIds();
    console.log(`Tenants configurados (${ids.length}):`);
    for (const id of ids) console.log(`  - ${id}`);
    return;
  }

  const tenantId = typeof args.tenant === "string" && args.tenant ? args.tenant : null;
  if (!tenantId) {
    console.error("Indica --tenant <id> (o --list-clients).");
    console.log(USAGE);
    process.exit(1);
  }

  if (args.validate) {
    const check = validateTenant(tenantId);
    box(check.ok ? "VALIDACIÓN OK" : "VALIDACIÓN FALLÓ", check.ok ? [`Tenant ${tenantId} válido.`] : check.errors);
    if (!check.ok) process.exit(1);
    return;
  }

  if (args.diff) {
    const diff = await diffTenant(tenantId);
    box(`DIFF · ${diff.tenantId} (secret: ${diff.secret.name}${diff.secret.existing ? "" : " — se creará"})`, [
      ...diff.plan.map((p) => `[${p.action.padEnd(6)}] ${p.kind.padEnd(8)} ${p.name}${p.note ? ` — ${p.note}` : ""}`),
    ]);
    return;
  }

  box("FACTORIA AGENT CORE · PROVISIONING", [
    `tenant   : ${tenantId}`,
    `api key  : ${hasElevenLabsApiKey() ? "configurada" : "FALTA (ELEVENLABS_API_KEY)"}`,
    `dry-run  : ${args.dryRun ? "SÍ" : "no"}`,
    `force    : ${args.forceUpdate ? "tools + agente" : "no"}`,
    `secret   : ${args.rotateSecret ? "rotar" : "usar env/guardado"}`,
  ]);

  if (!hasElevenLabsApiKey() && !args.dryRun) {
    console.error("ELEVENLABS_API_KEY no está definida. Define env y reintenta (o usa --dry-run).");
    process.exit(1);
  }

  const result = await provisionTenant(tenantId, {
    dryRun: Boolean(args.dryRun),
    forceUpdateTool: Boolean(args.forceUpdate),
    forceUpdateAgent: Boolean(args.forceUpdate),
    rotateSecret: Boolean(args.rotateSecret),
  });

  box(`PLAN EJECUTADO · ${result.tenantId}`, [
    ...result.plan.map((p) => `[${p.action.padEnd(6)}] ${p.kind.padEnd(10)} ${p.name}${p.note ? ` — ${p.note}` : ""}`),
    `agent id : ${result.agentId}`,
    `tools    : ${result.toolIds.join(", ")}`,
  ]);

  if (result.generatedSecret) {
    box("⚠ NUEVO SECRET — guárdalo en el entorno", [
      `${result.secretRef}=${result.generatedSecret}`,
      `  (secret store en ElevenLabs: ${result.secret.name})`,
      "  • Pega la línea en .env (o en Vercel → Settings → Environment Variables).",
      "  • El valor YA quedó en el secret store de ElevenLabs (selector) y su hash en la DB.",
      "  • No se muestra de nuevo en runs posteriores.",
    ]);
  }

  if (result.agentId && !result.agentId.startsWith("(") && !args.dryRun) {
    const base = (process.env.NEXT_PUBLIC_FACTORIA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const envName = result.secretRef;
    box("SIGUIENTES PASOS", [
      `  • Widget del tenant: ${base}/widget/${result.tenantId}`,
      `  • Probar una tool por línea:`,
      `    curl -X POST ${base}/api/tools/<tool> \\`,
      `      -H "Authorization: Bearer $${envName}" -H "Content-Type: application/json" \\`,
      `      -d '{"user_name":"Ana"}'`,
    ]);
  }
}

main()
  .catch((err) => {
    console.error("\n[setup] error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Cierra el pool de Postgres para que el proceso termine.
    const { closeDb } = await import("@/lib/db/client");
    await closeDb().catch(() => {});
  });