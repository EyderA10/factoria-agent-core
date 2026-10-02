import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/telephony/outbound-call/route";

/**
 * Aislamiento de las llamadas salientes.
 *
 * Es el endpoint que permite a un consumidor pedir llamadas salientes usando el
 * workspace compartido de ElevenLabs. Lo que se prueba aquí es que la identidad del
 * tenant se PRUEBA (secret Bearer) y que ni el agente ni el número de salida los
 * elige quien llama: el cuerpo solo puede decidir a quién se llama.
 */
const limiter = vi.hoisted(() => ({
  blocked: false,
  hits: [] as { scope: string; key: string }[],
  hit(scope: string, key: string) {
    limiter.hits.push({ scope, key });
    return { count: 1, blocked: limiter.blocked, limit: 30, retryAfterSeconds: 120 };
  },
}));

const calls = vi.hoisted(() => ({
  outbound: [] as { agentId: string; agentPhoneNumberId: string; toNumber: string }[],
  resolveAgent: [] as (string | null | undefined)[],
}));

vi.mock("@/lib/ratelimit", () => ({
  DEFAULT_RULES: {
    sessionPerTenant: { windowSeconds: 3600, max: 60 },
    sessionPerIp: { windowSeconds: 60, max: 10 },
    outboundPerTenant: { windowSeconds: 3600, max: 30 },
  },
  clientIpFrom: () => "203.0.113.5",
  postgresRateLimiter: { hit: limiter.hit },
}));

vi.mock("@/lib/elevenlabs", () => ({
  hasElevenLabsApiKey: () => true,
  elevenLabsErrorMessage: (_error: unknown, fallback: string) => fallback,
  resolveAgentIdForTenant: async (tenantId?: string | null) => {
    calls.resolveAgent.push(tenantId);
    if (tenantId === "mesa-y-cia") return "agent_mesa";
    if (tenantId === "vitea") return "agent_vitea";
    if (tenantId === "sin-telefonia") return "agent_sin_telefonia";
    return null;
  },
  getElevenLabsClient: () => ({
    conversationalAi: {
      twilio: {
        outboundCall: async (params: { agentId: string; agentPhoneNumberId: string; toNumber: string }) => {
          calls.outbound.push(params);
          return { call_id: "call_1" };
        },
      },
    },
  }),
}));

const TENANTS = [
  { id: "mesa-y-cia", hash: "hash_mesa" },
  { id: "vitea", hash: "hash_vitea" },
  { id: "sin-telefonia", hash: "hash_sin_telefonia" },
];

vi.mock("@/lib/tenants/resolver", () => ({
  resolveTenantFromAuth: async (header: string | null) => {
    const token = header?.replace(/^Bearer\s+/i, "") ?? "";
    const match = TENANTS.find((t) => t.hash === token);
    return match ? { tenantId: match.id, enabled: true } : null;
  },
}));

vi.mock("@/lib/tenants/store", () => {
  const real = JSON.parse(
    readFileSync(resolve(__dirname, "../config/tenants/mesa-y-cia.json"), "utf8")
  );
  return {
    listTenantIds: () => ["mesa-y-cia", "vitea"],
    loadTenantConfig: (id: string) => {
      const base = { ...real, id, name: id };
      if (id === "mesa-y-cia") return { ...base, telephony: { agentPhoneNumberId: "phone_mesa_1" } };
      if (id === "vitea") return { ...base, telephony: { agentPhoneNumberId: "phone_vitea_1" } };
      if (id === "sin-telefonia") return base;
      throw new Error("unknown");
    },
  };
});

function post(body: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return POST(
    new NextRequest("http://localhost/api/telephony/outbound-call", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  limiter.blocked = false;
  limiter.hits = [];
  calls.outbound = [];
  calls.resolveAgent = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/telephony/outbound-call · autorización", () => {
  it("sin secret responde 401 y no llama a ElevenLabs", async () => {
    const res = await post({ toNumber: "+573001234567" });

    expect(res.status).toBe(401);
    expect(calls.outbound).toHaveLength(0);
    expect(limiter.hits).toHaveLength(0);
  });


  it("el secret de otro tenant no sirve para esta llamada", async () => {
    const res = await post({ toNumber: "+573001234567" }, "hash_vitea");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].agentId).toBe("agent_vitea");
    expect(calls.outbound[0].agentId).not.toBe("agent_mesa");
  });
});

describe("POST /api/telephony/outbound-call · recursos de otro tenant", () => {
  it("ignora agentId del cuerpo: usa el agente del tenant autenticado", async () => {
    const res = await post({ toNumber: "+573001234567", agentId: "agent_vitea" }, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].agentId).toBe("agent_mesa");
    expect(calls.outbound[0].agentId).not.toBe("agent_vitea");
  });

});

describe("POST /api/telephony/outbound-call · request válido", () => {
  it("marca la llamada con los recursos del tenant", async () => {
    const res = await post({ toNumber: "+573001234567" }, "hash_mesa");
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(calls.outbound).toEqual([
      { agentId: "agent_mesa", agentPhoneNumberId: "phone_mesa_1", toNumber: "+573001234567" },
    ]);
  });

  it("sin número devuelve 400 sin llamar a ElevenLabs", async () => {
    const res = await post({}, "hash_mesa");

    expect(res.status).toBe(400);
    expect(calls.outbound).toHaveLength(0);
  });

  it("un destino que no es E.164 devuelve 400", async () => {
    const res = await post({ toNumber: "573001234567" }, "hash_mesa");

    expect(res.status).toBe(400);
    expect(calls.outbound).toHaveLength(0);
  });


  it("tenant sin teléfono configurado devuelve 503 y no marca nada", async () => {
    const res = await post({ toNumber: "+573001234567" }, "hash_sin_telefonia");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("telephony_not_configured");
    expect(calls.outbound).toHaveLength(0);
  });

  it("cuota superada: 429 sin llamar a ElevenLabs", async () => {
    limiter.blocked = true;
    const res = await post({ toNumber: "+573001234567" }, "hash_mesa");
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(body.error).toBe("rate_limited");
    expect(calls.outbound).toHaveLength(0);
    expect(limiter.hits).toEqual([{ scope: "tenant", key: "mesa-y-cia" }]);
  });

  it("el error de ElevenLabs no filtra el detalle al cliente", async () => {
    const el = await import("@/lib/elevenlabs");
    vi.spyOn(el, "getElevenLabsClient").mockReturnValue({
      conversationalAi: {
        twilio: {
          outboundCall: async () => {
            throw new Error("secret interno de ElevenLabs: sk_abc123");
          },
        },
      },
    } as never);

    const res = await post({ toNumber: "+573001234567" }, "hash_mesa");
    const text = await res.text();

    expect(res.status).toBe(502);
    expect(text).not.toContain("sk_abc123");
  });
});