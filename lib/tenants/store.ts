import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tenantConfigSchema, type TenantConfig } from "./model";

/**
 * Acceso a la configuración de tenants (fuente de verdad en config/tenants/<id>.json).
 * Es la única pieza por cliente que se edita para montar un nuevo cliente.
 */

export const TENANTS_DIR = resolve(process.cwd(), "config/tenants");

function tenantFile(id: string): string {
  return join(TENANTS_DIR, `${id}.json`);
}

export function listTenantIds(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadTenantConfig(id: string): TenantConfig {
  const file = tenantFile(id);
  if (!existsSync(file)) {
    const available = listTenantIds().join(", ") || "(ninguno)";
    throw new Error(`No existe el tenant "${id}" en config/tenants/. Disponibles: ${available}`);
  }
  return tenantConfigSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as TenantConfig;
}

export function loadAllTenantConfigs(): TenantConfig[] {
  return listTenantIds().map(loadTenantConfig);
}

export function findTenantByTool(toolName: string): TenantConfig[] {
  return loadAllTenantConfigs().filter((t) => t.tools.some((tool) => tool.name === toolName));
}

export function getToolConfig(tenant: TenantConfig, toolName: string) {
  return tenant.tools.find((tool) => tool.name === toolName);
}