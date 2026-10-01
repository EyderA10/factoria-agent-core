import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/widget/config/route";

vi.mock("@/lib/elevenlabs", () => ({
  resolveAgentIdForTenant: async (tenantId: string) => `agent_${tenantId}`,
}));

vi.mock("@/lib/tenants/store", () => {
  const mesa = JSON.parse(readFileSync(resolve(__dirname, "../config/tenants/mesa-y-cia.json"), "utf8"));
  return {
    listTenantIds: () => ["mesa-y-cia", "vitea"],
    loadTenantConfig: (id: string) => {
      if (id === "mesa-y-cia") return mesa;
      if (id === "vitea") return { ...mesa, id: "vitea", name: "Vitea" };
      if (id === "deshabilitado") return { ...mesa, id: "deshabilitado", enabled: false };
      throw new Error("unknown");
    },
  };
});

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/widget/config${query}`));
}

function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/widget/config · no filtra recursos del workspace", () => {
  it("no expone el agentId del tenant", async () => {
    const res = await get("?tenant=mesa-y-cia");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty("agentId");
    expect(JSON.stringify(body)).not.toContain("agent_mesa-y-cia");
  });

  it("sigue devolviendo lo que el embedder necesita", async () => {
    const res = await get("?tenant=mesa-y-cia");
    const body = await res.json();

    expect(body.tenant).toMatchObject({ id: "mesa-y-cia", slug: "mesa-y-cia" });
    expect(body.branding.title).toBe("Mesa & Cía");
    expect(body.firstMessage).toContain("Mesa & Cía");
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual(["reserve_table", "check_weather"]);
  });

  it("no incluye prompts ni reglas de negocio", async () => {
    const body = await (await get("?tenant=mesa-y-cia")).json();

    expect(body).not.toHaveProperty("systemPrompt");
    expect(JSON.stringify(body)).not.toContain("Normas de uso de tools");
  });
});

describe("GET /api/widget/config · listado de tenants", () => {
  it("en producción no permite enumerar los tenants", async () => {
    setNodeEnv("production");

    const res = await get("");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("tenant_required");
    expect(JSON.stringify(body)).not.toContain("mesa-y-cia");
  });

  it("fuera de producción sí ayuda a developear", async () => {
    setNodeEnv("development");

    const res = await get("");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tenants.map((t: { id: string }) => t.id)).toEqual(["mesa-y-cia", "vitea"]);
  });
});

describe("GET /api/widget/config · validación", () => {
  it("tenant desconocido devuelve 404", async () => {
    expect((await get("?tenant=no-existe")).status).toBe(404);
  });

  it("tenant deshabilitado devuelve 403", async () => {
    expect((await get("?tenant=deshabilitado")).status).toBe(403);
  });
});