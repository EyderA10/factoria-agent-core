import { describe, expect, it, vi, beforeEach } from "vitest";

const seen: { tenantId?: string | null } = {};

vi.mock("@/lib/elevenlabs", () => ({
  sessionForAgent: async (tenantId?: string | null) => {
    seen.tenantId = tenantId;
    throw new Error("agent_id_required");
  },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/elevenlabs/session/route";

function req(query: string) {
  return new NextRequest(`http://localhost/api/elevenlabs/session${query}`);
}

beforeEach(() => {
  seen.tenantId = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/elevenlabs/session", () => {
  it("ignora agentId del cliente: solo resuelve por tenant", async () => {
    const res = await GET(req("?agentId=agent_de_otro_tenant"));

    expect(res.status).toBe(400);
    expect(seen.tenantId).toBeUndefined();
  });

  it("pasa el tenant recibido al resolver el agente", async () => {
    await GET(req("?tenant=vitea"));
    expect(seen.tenantId).toBe("vitea");
  });

  it("agentId junto a tenant no altera la resolución", async () => {
    await GET(req("?tenant=vitea&agentId=agent_de_otro_tenant"));
    expect(seen.tenantId).toBe("vitea");
  });

  it("sin tenant devuelve la guía de provisioning", async () => {
    const res = await GET(req(""));
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe("not_configured");
    expect(body.hint).toContain("?tenant=");
    expect(body.hint).not.toContain("agentId");
  });
});
