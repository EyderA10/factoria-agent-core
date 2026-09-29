import { getToolConfig } from "@/lib/tenants/store";
import type { ToolDefinition, ToolContext, ToolResult } from "./types";

type StockSettings = {
  currency?: string;
  catalog?: { sku: string; name: string; category?: string; price: number; sizes: Record<string, number> }[];
};

/**
 * Tool genérica "check_stock" (retail): el catálogo, precios y stock provienen de la
 * config del tenant, nunca del core.
 */
const checkStock: ToolDefinition = {
  name: "check_stock",
  description: "Consulta disponibilidad, tallas y precio de productos del tenant.",
  handler: async (input, ctx: ToolContext): Promise<ToolResult> => {
    const s = (getToolConfig(ctx.tenant, "check_stock")?.settings ?? {}) as StockSettings;
    const catalog = s.catalog ?? [];
    const currency = (s.currency ?? "usd").toUpperCase();

    const sku = typeof input.sku === "string" ? input.sku.trim().toUpperCase() : "";
    const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";

    const hits = sku
      ? catalog.filter((p) => p.sku === sku)
      : catalog.filter(
          (p) =>
            query === "" ||
            p.name.toLowerCase().includes(query) ||
            (p.category ?? "").toLowerCase().includes(query)
        );

    if (hits.length === 0) {
      return {
        ok: true,
        data: {
          found: false,
          message: `No encontré ${sku ? `el SKU ${sku}` : `nada similar a "${query}"`} en el catálogo.`,
        },
      };
    }

    return {
      ok: true,
      data: {
        found: true,
        currency,
        items: hits.map((p) => ({
          sku: p.sku,
          name: p.name,
          category: p.category ?? null,
          price: p.price,
          sizes: Object.fromEntries(Object.entries(p.sizes).filter(([, n]) => n > 0)),
        })),
        message: `Encontré ${hits.length} producto${hits.length > 1 ? "s" : ""} en el catálogo.`,
      },
    };
  },
};

export default checkStock;