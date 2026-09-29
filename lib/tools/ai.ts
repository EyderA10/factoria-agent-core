import { tool } from "ai";
import type { Tool } from "ai";
import { executeTool } from "./index";
import { buildZodSchema } from "./types";
import type { TenantConfig } from "@/lib/tenants/model";

/**
 * Registry de la FactorIA Tool Layer para agentes internos (Vercel AI SDK).
 * Construye las tools del tenant con el MISMO contrato Zod y handler que usa el
 * agente de ElevenLabs vía webhook tool (single source of truth).
 *
 *   import { factoriaToolsForTenant } from "@/lib/tools/ai";
 *   const tools = factoriaToolsForTenant(loadTenantConfig("vitea"));
 *   const { text } = await generateText({ model, tools, prompt });
 */
type FactoriaTool = Tool<Record<string, unknown>, Record<string, unknown>>;

export function factoriaToolsForTenant(tenant: TenantConfig): Record<string, FactoriaTool> {
  const tools: Record<string, FactoriaTool> = {};
  for (const cfg of tenant.tools) {
    tools[cfg.name] = tool({
      description: cfg.description,
      inputSchema: buildZodSchema(cfg),
      execute: async (args) => {
        const res = await executeTool(tenant, cfg.name, args);
        if (res.status === "ok") return res.data;
        if (res.status === "invalid_payload") {
          throw new Error(`Payload inválido para ${cfg.name}: ${res.reason}`);
        }
        throw new Error(`Tool ${cfg.name} no disponible para este tenant`);
      },
    });
  }
  return tools;
}