import { getToolConfig } from "@/lib/tenants/store";
import type { ToolDefinition, ToolContext, ToolResult } from "./types";

type TableSettings = {
  currency?: string;
  hours?: { from?: string; to?: string; tz?: string };
  tables?: { id: string; seats: number; available: boolean }[];
};

/**
 * Tool genérica "reserve_table" (gastronomía): toda la lógica de negocio (capacidades
 * de mesas, horarios, moneda) proviene de la config del tenant, nunca del core.
 */
const reserveTable: ToolDefinition = {
  name: "reserve_table",
  description: "Reserva una mesa según capacidad disponible del tenant.",
  handler: async (input, ctx: ToolContext): Promise<ToolResult> => {
    const s = (getToolConfig(ctx.tenant, "reserve_table")?.settings ?? {}) as TableSettings;
    const tables = s.tables ?? [];
    const partySize = typeof input.party_size === "number" ? input.party_size : undefined;
    const date = typeof input.date === "string" ? input.date : undefined;

    if (!partySize || partySize < 1) {
      return { ok: false, code: "invalid_party_size", detail: "party_size debe ser un número ≥ 1" };
    }
    if (!date) {
      return { ok: false, code: "invalid_date", detail: "date es obligatoria (YYYY-MM-DD)" };
    }

    const candidates = tables
      .filter((t) => t.available && t.seats >= partySize)
      .sort((a, b) => a.seats - b.seats);

    if (candidates.length === 0) {
      return {
        ok: true,
        data: {
          available: false,
          date,
          party_size: partySize,
          message: `No hay mesa disponible para ${partySize} personas el ${date}. Podemos buscar otra fecha u hora.`,
        },
      };
    }

    const table = candidates[0];
    return {
      ok: true,
      data: {
        available: true,
        date,
        party_size: partySize,
        table_id: table.id,
        seats: table.seats,
        hours: s.hours ?? null,
        message: `Mesa ${table.id} (${table.seats} personas) reservada para el ${date}. Te esperamos.`,
      },
    };
  },
};

export default reserveTable;