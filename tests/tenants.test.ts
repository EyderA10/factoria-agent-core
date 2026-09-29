import { describe, expect, it } from "vitest";
import { buildZodSchema, parseToolInput } from "@/lib/tools/types";
import { loadTenantConfig, listTenantIds, loadAllTenantConfigs, getToolConfig } from "@/lib/tenants/store";
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
  const reserveTable = getToolConfig(loadTenantConfig("mesa-y-cia"), "reserve_table")!;
  const checkStock = getToolConfig(loadTenantConfig("vitea"), "check_stock")!;

  it("acepta payload válido (required respetado)", () => {
    const parsed = parseToolInput(reserveTable, JSON.stringify({ date: "2026-10-05", party_size: 4 }));
    expect(parsed.ok).toBe(true);
  });

  it("rechaza payload inválido (falta required)", () => {
    const parsed = parseToolInput(reserveTable, JSON.stringify({ date: "2026-10-05" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("validation_failed");
  });

  it("rechaza tipo incorrecto (integer no acepta string)", () => {
    const parsed = parseToolInput(reserveTable, JSON.stringify({ date: "2026-10-05", party_size: "cuatro" }));
    expect(parsed.ok).toBe(false);
  });

  it("rechaza JSON inválido", () => {
    const parsed = parseToolInput(reserveTable, "{no-json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_json");
  });

  it("los campos opcionales se pueden omitir", () => {
    const parsed = parseToolInput(checkStock, JSON.stringify({ query: "camiseta" }));
    expect(parsed.ok).toBe(true);
  });

  it("el schema Zod es objeto y usable con safeParse", () => {
    const schema = buildZodSchema(checkStock);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ sku: 1 }).success).toBe(false);
  });
});
