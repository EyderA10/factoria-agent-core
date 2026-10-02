/**
 * Generador interactivo de un tenant nuevo (npm run setup:new).
 *
 * Solo CREA config/tenants/<id>.json (fuente de verdad). El provisioning se hace
 * después con:
 *   npm run setup -- --tenant <id> --diff
 *   npm run setup -- --tenant <id>
 */
import "dotenv/config";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { config as loadLocalEnv } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { listTenantIds } from "@/lib/tenants/store";
import { tenantConfigSchema } from "@/lib/tenants/model";

loadLocalEnv({ path: resolve(process.cwd(), ".env.local") });

const EXISTING = new Set(listTenantIds());

const TOOL_INFO: Record<string, { desc: string; seed: (name: string, currency: string) => unknown }> = {
  reserve_table: {
    desc: "Restaurante: mesas, capacidad y horario",
    seed: (name, currency) => ({
      currency,
      hours: { from: "09:00", to: "22:00", tz: "America/Bogota" },
      tables: [
        { id: "T1", seats: 2, available: true },
        { id: "T2", seats: 4, available: true },
        { id: "T3", seats: 6, available: true },
        { id: "T4", seats: 8, available: true },
      ],
    }),
  },
  check_stock: {
    desc: "Retail: catálogo, tallas, stock y precios",
    seed: (_name, currency) => ({
      currency,
      catalog: [
        { sku: "S-001", name: "Vestido Flow", category: "vestidos", price: 89990, sizes: { S: 4, M: 7, L: 2, XL: 0 } },
        { sku: "S-002", name: "Blusa Serena", category: "blusas", price: 39990, sizes: { S: 9, M: 5, L: 3 } },
        { sku: "S-003", name: "Pantalón Cargo", category: "pantalones", price: 109990, sizes: { S: 0, M: 4, L: 6, XL: 2 } },
      ],
    }),
  },
  check_weather: {
    desc: "Clima real (Open-Meteo): terraza / plan al aire libre",
    seed: (name) => ({ name, latitude: 4.711, longitude: -74.0721, rain_threshold_mm: 1 }),
  },
};

const rl = createInterface({ input, output });

/** Respuestas por CLI: si viene algún flag, el script corre NO interactivo
 *  (usa flags + defaults, sin prompts) — así es testeable y usable en CI. */
const ARGV = process.argv.slice(2);
const NON_INTERACTIVE = ARGV.length > 0;
function flag(name: string): string | undefined {
  const i = ARGV.indexOf(`--${name}`);
  return i === -1 ? undefined : ARGV[i + 1];
}

async function ask(flagName: string, question: string, fallback?: string) {
  const provided = flag(flagName);
  if (provided !== undefined) {
    console.log(`${question}: ${provided}  (--${flagName})`);
    return provided;
  }
  if (NON_INTERACTIVE) {
    if (fallback === undefined) {
      console.error(`✗ Falta --${flagName} (${question}) en modo no interactivo.`);
      process.exit(1);
    }
    console.log(`${question}: ${fallback}  (default)`);
    return fallback;
  }
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer === "" && fallback !== undefined ? fallback : answer;
}

async function main() {
  console.log("── Generador de tenant nuevo ───────────────────────────────");

  const id = (await ask("id", "id (slug Unix, ej: casa-lorena)")).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (EXISTING.has(id)) {
    console.error(`✗ Ya existe config/tenants/${id}.json`);
    process.exit(1);
  }

  const name = await ask("name", "nombre comercial (ej: Casa Lorena)", id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const slug = await ask("slug", "slug", id);
  const currency = (await ask("currency", "moneda (usd|cop|eur|mxn…)", "cop")).toLowerCase();
  const timezone = await ask("timezone", "timezone (IANA)", "America/Bogota");
  const language = await ask("language", "idioma (es|en…)", "es");
  const firstMessage = await ask(
    "first-message",
    "primer mensaje del agente",
    `¡Hola! Soy ${name}. ¿En qué puedo ayudarte hoy?`
  );
  const ttsModel = await ask("tts", "modelo TTS (eleven_flash_v2_5 | eleven_turbo_v2_5)", "eleven_flash_v2_5");
  const llm = await ask("llm", "modelo LLM (gemini-2.5-flash | gpt-4o-mini…)", "gemini-2.5-flash");
  const tagline = await ask("tagline", "tagline (frase corta de marca)", `Ayudamos con ${name}`);
  const primaryColor = await ask("color", "color primario (hex)", "#6D28D9");
  const icon = await ask("icon", "icono (emoji)", "✨");

  const toolsPick = (await ask(
    "tools",
    `tools a incluir (separadas por coma): ${Object.entries(TOOL_INFO)
      .map(([k, v]) => `${k} (${v.desc})`)
      .join(" | ")}`,
    Object.keys(TOOL_INFO).join(",")
  )).split(",").map((s) => s.trim()).filter((s) => s in TOOL_INFO);

  if (!toolsPick.length) {
    console.error("✗ No se seleccionó ninguna tool válida.");
    process.exit(1);
  }

  const secretRef = `FACTORIA_TENANT_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_SECRET`;
  const tools = toolsPick.map((t) => ({
    name: t,
    description: TOOL_INFO[t].desc,
    inputSchema: JSON.parse(JSON.stringify(FALLBACK_INPUT_SCHEMAS[t])),
    settings: TOOL_INFO[t].seed(name, currency),
  }));

  const config = {
    id,
    slug,
    name,
    enabled: true,
    auth: { secretRef },
    branding: { title: name, tagline, primaryColor, icon },
    agent: {
      name: `${name} Assistant`,
      firstMessage,
      language,
      timezone,
      ttsModel,
      llm,
      systemPrompt:
        `Eres el asistente virtual de ${name}. Responde siempre en ${language === "es" ? "español" : "inglés"}, usa un tono profesional y cercano.` +
        ` Cuando necesites información usa EXCLUSIVAMENTE las tools proporcionadas; si no puedes resolverlo, deriva amablemente a otro canal.` +
        `\n\nReglas de comportamiento conversacional:\n` +
        `1. Saluda UNA SOLA VEZ al inicio. No repitas tu nombre en turnos posteriores.\n` +
        `2. Cierra como MÁXIMO una vez por turno con una frase breve tipo '¿Algo más en lo que pueda ayudarte?'.\n` +
        `3. Despídete solo si el usuario se despide o pide terminar.`,
    },
    tools,
    // Origen único autorizado al crear el tenant: el nuestro en local. El dominio
    // real del cliente se añade en el onboarding (checklist §6). Vacío = embed
    // cerrado, así que dejarlo vacío sería el estado honesto pero no developer-friendly.
    allowedOrigins: ["http://localhost:3000"],
  };

  // El config generado debe cumplir EXACTAMENTE el mismo modelo que el resto del core.
  const parsed = tenantConfigSchema.safeParse(config);
  if (!parsed.success) {
    console.error("\n✗ El config generado no cumple tenantConfigSchema:");
    for (const issue of parsed.error.issues) {
      console.error(`  · ${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
    }
    console.error(`\nCorrige las respuestas y vuelve a ejecutar, o edita a mano el archivo ya generado.`);
    process.exit(1);
  }
  if (parsed.data.auth.secretRef !== config.auth.secretRef) {
    console.warn("! aviso: secretRef normalizado por el schema");
  }

  mkdirSync(resolve(process.cwd(), "config/tenants"), { recursive: true });
  const fileName = `config/tenants/${id}.json`;
  writeFileSync(resolve(process.cwd(), fileName), JSON.stringify(config, null, 2) + "\n");

  console.log(`\n✓ Creado ${fileName}`);
  console.log("\nSiguiente paso — valida y provisiona:");
  console.log(`  npm run setup -- --tenant ${id} --validate`);
  console.log(`  npm run setup -- --tenant ${id} --diff`);
  console.log(`  npm run setup -- --tenant ${id}`);
  console.log(`  npm run setup -- --tenant ${id} --dry-run  # (si solo quieres el plan)`);
  console.log(`\nEl secret se generará en el provisioning y NUNCA va al repo.`);
  console.log(`Variable de entorno para este tenant: ${secretRef}`);
  console.log(`\nDespués del provisioning, cópiala a .env local y a Vercel para que el dispatcher pueda autenticar.`);
}

const FALLBACK_INPUT_SCHEMAS: Record<string, unknown> = {
  reserve_table: {
    properties: {
      date: { type: "string", description: "Fecha de la reserva (YYYY-MM-DD)" },
      party_size: { type: "integer", description: "Número de personas" },
      user_name: { type: "string", description: "Nombre de quien reserva (opcional)" },
    },
    required: ["date", "party_size"],
  },
  check_stock: {
    properties: {
      sku: { type: "string", description: "Código SKU exacto (opcional)" },
      query: { type: "string", description: "Búsqueda por nombre o categoría (opcional)" },
    },
    required: [],
  },
  check_weather: {
    properties: {
      date: { type: "string", description: "Fecha a consultar (YYYY-MM-DD, opcional)" },
    },
    required: [],
  },
};

main()
  .catch((err) => {
    console.error("\n[setup:new] error:", err);
    process.exit(1);
  })
  .finally(() => rl.close());