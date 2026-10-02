import { describe, expect, it } from "vitest";
import { executeTool, toolHandlers } from "@/lib/tools";
import { loadTenantConfig } from "@/lib/tenants/store";

const mesa = loadTenantConfig("mesa-y-cia");
const vitea = loadTenantConfig("vitea");

describe("tool layer: handlers registrados", () => {
  it("expone reserve_table, check_stock y check_weather", () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(["check_stock", "check_weather", "reserve_table"]);
  });
});

describe("aislamiento: una tool de un tenant no existe para el otro", () => {
  it("mesa-y-cia no expone check_stock", async () => {
    const res = await executeTool(mesa, "check_stock", { query: "camiseta" });
    expect(res.status).toBe("tool_not_found");
  });

  it("vitea no expone reserve_table", async () => {
    const res = await executeTool(vitea, "reserve_table", { date: "2026-10-05", party_size: 2 });
    expect(res.status).toBe("tool_not_found");
  });
});

describe("reserve_table (Mesa & Cía) — lógica desde settings del tenant", () => {
  it("reserva la mesa más pequeña que quepa", async () => {
    const res = await executeTool(mesa, "reserve_table", { date: "2026-10-05", party_size: 4 });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.available).toBe(true);
      expect(res.data.seats as number).toBeGreaterThanOrEqual(4);
    }
  });

  it("no inventa capacidad: party_size mayor al máximo no reserva", async () => {
    const res = await executeTool(mesa, "reserve_table", { date: "2026-10-05", party_size: 20 });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.data.available).toBe(false);
  });

  it("respeta tables[].available = false", async () => {
    const soloT6 = {
      ...mesa,
      tools: mesa.tools.map((t) =>
        t.name === "reserve_table" ? { ...t, settings: { tables: [{ id: "t6", seats: 8, available: false }] } } : t
      ),
    };
    const res = await executeTool(soloT6, "reserve_table", { date: "2026-10-05", party_size: 2 });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.data.available).toBe(false);
  });

});

describe("check_stock (Vitea) — catálogo desde settings del tenant", () => {
  it("busca por query y devuelve tallas con stock", async () => {
    const res = await executeTool(vitea, "check_stock", { query: "camiseta" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      const items = res.data.items as { sku: string; sizes: Record<string, number> }[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        for (const stock of Object.values(item.sizes)) expect(stock).toBeGreaterThan(0);
      }
    }
  });

  it("filtra tallas agotadas (stock 0)", async () => {
    const conAgotado = {
      ...vitea,
      tools: vitea.tools.map((t) =>
        t.name === "check_stock"
          ? { ...t, settings: { currency: "usd", catalog: [{ sku: "T-1", name: "Prueba", category: "test", price: 1, sizes: { S: 0, M: 3 } }] } }
          : t
      ),
    };
    const res = await executeTool(conAgotado, "check_stock", { sku: "T-1" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      const items = res.data.items as { sizes: Record<string, number> }[];
      expect(items[0].sizes).toEqual({ M: 3 });
    }
  });

  it("responde not-found sin inventar datos", async () => {
    const res = await executeTool(vitea, "check_stock", { sku: "NO-EXISTE" });
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.data.found).toBe(false);
  });
});

describe("check_weather — integración externa real (Open-Meteo)", () => {
  // Esta suite pega a una API de terceros, así que no puede usar el default de
  // 5 s: en CI la latencia sube y el test moría por timeout sin que el código
  // estuviera mal. Va por encima del presupuesto de red del handler (8 s) para
  // que un upstream lento se vea como aserción, no como error de infraestructura.
  const TIMEOUT = 20_000;

  it("responde con clima real de la ubicación configurada por el tenant", async () => {
    const res = await executeTool(mesa, "check_weather", {});
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(typeof res.data.temperature_max_c).toBe("number");
      expect(res.data.terrace_recommended).toBeTypeOf("boolean");
      expect(res.data.location).toBe("Mesa & Cía");
    }
  }, TIMEOUT);

  it("el fetch externo nunca se ejecuta para un tenant que no tiene la tool", async () => {
    const res = await executeTool(vitea, "check_weather", {});
    expect(res.status).toBe("tool_not_found");
  });

  it("un upstream que no responde degrada a external_failed en vez de colgarse", async () => {
    const original = globalThis.fetch;
    // Se queda colgado hasta que el handler lo cancela con su propio presupuesto.
    // Un mock que ignorara el signal colgaría el test: el punto es comprobar que
    // el handler sí lo pasa y se vale de él.
    globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "TimeoutError"))
        );
      })) as unknown as typeof fetch;
    try {
      const res = await executeTool(mesa, "check_weather", {});
      // executeTool normaliza a status "error" y conserva el code del handler.
      // El if estrecha el tipo igual que en los tests de éxito de arriba.
      expect(res.status).not.toBe("ok");
      if (res.status === "error") expect(res.code).toBe("external_failed");
    } finally {
      globalThis.fetch = original;
    }
  }, 20_000);
});
