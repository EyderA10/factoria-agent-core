import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseToolInput } from "@/lib/tools/types";
import { loadTenantConfig, listTenantIds, loadAllTenantConfigs, getToolConfig, TENANTS_DIR } from "@/lib/tenants/store";
import { tenantConfigSchema } from "@/lib/tenants/model";

describe("tenants: config como fuente de verdad", () => {
  it("carga los tenants del repo y todos son válidos contra el modelo", () => {
    const ids = listTenantIds();
    expect(ids).toContain("mesa-y-cia");
    expect(ids).toContain("vitea");
    for (const cfg of loadAllTenantConfigs()) {
      expect(tenantConfigSchema.safeParse(cfg).success).toBe(true);
    }
  });

  it("cada tenant declara auth.secretRef (el secret nunca está en el repo)", () => {
    for (const cfg of loadAllTenantConfigs()) {
      expect(cfg.auth.secretRef).toMatch(/^FACTORIA_/);
      const raw = JSON.stringify(cfg);
      expect(raw).not.toMatch(/Bearer\s/);
    }
  });

  it("cada tool del tenant tiene contrato inputSchema y settings", () => {
    for (const cfg of loadAllTenantConfigs()) {
      for (const tool of cfg.tools) {
        expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
        expect(tool.settings).toBeTypeOf("object");
      }
    }
  });
});

describe("tenants: contrato Zod derivado del config", () => {
  // Pereza a propósito: cargar el config dentro del test (y no en el `describe`)
  // hace que un config roto falle con un aserción legible en vez de abortar la
  // recolección del archivo entero, que|reporta "no tests" sin decir por qué.
  const reserveTable = () => getToolConfig(loadTenantConfig("mesa-y-cia"), "reserve_table")!;

  it("acepta payload válido (required respetado)", () => {
    const parsed = parseToolInput(reserveTable(), JSON.stringify({ date: "2026-10-05", party_size: 4 }));
    expect(parsed.ok).toBe(true);
  });

  it("rechaza payload inválido (falta required)", () => {
    const parsed = parseToolInput(reserveTable(), JSON.stringify({ date: "2026-10-05" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("validation_failed");
  });
});

const VALID = loadTenantConfig("mesa-y-cia");

  it("no deja que un id manipulado salga del directorio de tenants", () => {
    expect(() => loadTenantConfig("../../package")).toThrow(/inválido/);
    expect(() => loadTenantConfig("..%2F..%2Fpackage")).toThrow(/inválido/);
  });

describe("tenants: contrato de allowedOrigins en el fichero real", () => {
  const files = ["mesa-y-cia", "vitea", "_template"];

  it("la clave está en la raíz del JSON, no anidada dentro de agent", () => {
    for (const id of files) {
      const raw = JSON.parse(readFileSync(resolve(TENANTS_DIR, `${id}.json`), "utf8"));
      expect(raw, `${id} debe declarar allowedOrigins`).toHaveProperty("allowedOrigins");
      expect(
        (raw.agent as Record<string, unknown>).allowedOrigins,
        `${id}: allowedOrigins dentro de "agent" se descartaría en silencio`
      ).toBeUndefined();
    }
  });

  it("el modelo rechaza un config sin allowedOrigins en la raíz", () => {
    const raw = JSON.parse(readFileSync(resolve(TENANTS_DIR, "vitea.json"), "utf8"));
    const { allowedOrigins, ...sinClave } = raw;
    expect(allowedOrigins).toBeDefined();
    expect(tenantConfigSchema.safeParse(sinClave).success).toBe(false);
  });

  it("normaliza el origen para que la barra final no rompa el embed", () => {
    // https://cliente.com/ es como se escribe un dominio a mano y nunca casa con
    // el Origin que manda el navegador: el widget no cargaba y no habia error.
    const parsed = tenantConfigSchema.safeParse({ ...VALID, allowedOrigins: ["https://Cliente.com/"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.allowedOrigins).toEqual(["https://cliente.com"]);
  });

  it("rechaza un origen con comodin, path o esquema raro", () => {
    for (const origin of ["https://*.cliente.com", "https://cliente.com/app", "javascript:alert(1)"]) {
      expect(tenantConfigSchema.safeParse({ ...VALID, allowedOrigins: [origin] }).success).toBe(false);
    }
  });

  it("el modelo rechaza una clave desconocida dentro de agent", () => {
    const raw = JSON.parse(readFileSync(resolve(TENANTS_DIR, "vitea.json"), "utf8"));
    const anidada = { ...raw, agent: { ...raw.agent, allowedOrigins: [] } };
    const { allowedOrigins, ...raiz } = anidada;
    const parsed = tenantConfigSchema.safeParse(raiz);
    expect(parsed.success).toBe(false);
  });
});
