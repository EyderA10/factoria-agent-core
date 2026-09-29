import reserveTable from "./reserve-table";
import checkStock from "./check-stock";
import checkWeather from "./check-weather";
import type { ToolDefinition, ToolResult } from "./types";
import { parseToolInput } from "./types";
import type { TenantConfig } from "@/lib/tenants/model";
import { getToolConfig } from "@/lib/tenants/store";

/**
 * Catálogo de handlers de la FactorIA Tool Layer.
 * Cada tool es un `ToolDefinition` con lógica genérica: los datos/reglas de negocio
 * llegan vía `settings` de la config del tenant. Se reutilizan desde ElevenLabs
 * (endpoint HTTP) y desde agentes internos (registry de Vercel AI SDK).
 */
export const toolHandlers: Record<string, ToolDefinition["handler"]> = {
  reserve_table: reserveTable.handler,
  check_stock: checkStock.handler,
  check_weather: checkWeather.handler,
};

export const toolDescriptions: Record<string, { description: string }> = {
  reserve_table: { description: reserveTable.description },
  check_stock: { description: checkStock.description },
  check_weather: { description: checkWeather.description },
};

export type ExecuteToolResult =
  | { status: "ok"; data: Record<string, unknown> }
  | ({ status: "error" } & ToolResult & { code: string })
  | { status: "tool_not_found" }
  | { status: "invalid_payload"; reason: "invalid_json" | "validation_failed"; details?: unknown };

/** Ejecuta una tool del tenant: contrato Zod → handler → resultado consumible por el LLM. */
export async function executeTool(
  tenant: TenantConfig,
  toolName: string,
  rawBody: string | unknown
): Promise<ExecuteToolResult> {
  const toolConfig = getToolConfig(tenant, toolName);
  if (!toolConfig) return { status: "tool_not_found" };

  const parsed = parseToolInput(toolConfig, rawBody);
  if (!parsed.ok) {
    return { status: "invalid_payload", reason: parsed.reason, details: parsed.details };
  }

  const handler = toolHandlers[toolName];
  if (!handler) return { status: "tool_not_found" };

  const result = await handler(parsed.input, { tenant });
  return result.ok ? { status: "ok", data: result.data } : { status: "error", ...result };
}

export { buildZodSchema, parseToolInput } from "./types";
export type { ToolDefinition, ToolResult, ToolContext } from "./types";