import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/elevenlabs/session/route";

const seen: { tenantId?: string | null } = {};

// `vi.hoisted` porque las factories de vi.mock se izan por encima del módulo.
const limiter = vi.hoisted(() => {
  const state = {
    blocked: false,
    hits: [] as { scope: string; key: string }[],
    hit(scope: string, key: string) {
      state.hits.push({ scope, key });
      return {
        count: 1,
        blocked: state.blocked,
        limit: 10,
        retryAfterSeconds: 60,
      };
    },
    /** Último hit de un scope dado, o `undefined` si no se llegó a ese cubo. */
    keyFor(scope: string) {
      return [...state.hits].reverse().find((h) => h.scope === scope)?.key;
    },
  };
  return state;
});

vi.mock("@/lib/elevenlabs", () => ({
  sessionForAgent: async (tenantId?: string | null) => {
    seen.tenantId = tenantId;
    throw new Error("agent_id_required");
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  DEFAULT_RULES: {
    sessionPerTenant: { windowSeconds: 3600, max: 60 },
    sessionPerIp: { windowSeconds: 60, max: 10 },
    outboundPerTenant: { windowSeconds: 3600, max: 30 },
  },
  clientIpFrom: (headers: Headers) => {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    return headers.get("x-real-ip")?.trim() || "unknown";
  },
  postgresRateLimiter: { hit: limiter.hit },
}));

function req(query: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/elevenlabs/session${query}`, { headers });
}

function loadRealConfig(id: string) {
  return JSON.parse(readFileSync(resolve(__dirname, `../config/tenants/${id}.json`), "utf8"));
}

beforeEach(() => {
  seen.tenantId = undefined;
  limiter.blocked = false;
  limiter.hits = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/elevenlabs/session · aislamiento del agente", () => {
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

  it("tenant desconocido no resuelve agente ni filtra el error interno", async () => {
    const res = await GET(req("?tenant=no-existe"));
    expect(res.status).toBe(404);
    expect(seen.tenantId).toBeUndefined();
    expect(await res.text()).not.toContain("config/tenants");
  });
});

describe("GET /api/elevenlabs/session · control de abuso", () => {
  it("cuota por tenant: cuenta el tenant solicitado", async () => {
    await GET(req("?tenant=vitea"));
    expect(limiter.keyFor("tenant")).toBe("vitea");
  });

  it("IP con x-forwarded-for toma el primer salto (el cliente)", async () => {
    await GET(req("?tenant=vitea", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(limiter.keyFor("ip")).toBe("203.0.113.9");
  });

  it("bloqueado por cuota de tenant responde 429 sin resolver agente", async () => {
    limiter.blocked = true;
    const res = await GET(req("?tenant=vitea"));
    const body = (await res.json()) as { error: string; retryAfterSeconds: number };

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(body.error).toBe("rate_limited");
    expect(seen.tenantId).toBeUndefined();
  });

  it("el bloqueo por IP impide agotar la cuota de un cliente legítimo", async () => {
    limiter.blocked = true;
    const res = await GET(req("?tenant=vitea", { "x-forwarded-for": "198.51.100.7" }));
    expect(res.status).toBe(429);
    expect(seen.tenantId).toBeUndefined();
  });

  it("sin header de IP cae a un cubo compartido en vez de fallar", async () => {
    const res = await GET(req("?tenant=vitea"));
    expect(res.status).toBe(400);
    expect(limiter.keyFor("ip")).toBe("unknown");
  });

  it("tenant sin origins declarados acepta cualquier origen", async () => {
    const res = await GET(req("?tenant=vitea", { origin: "https://sitio- cualquiera.com" }));
    expect(res.status).not.toBe(403);
    expect(limiter.keyFor("tenant")).toBe("vitea");
  });

  it("origen restringido: el rechazo ocurre antes de tocar el rate limiter", async () => {
    const config = await import("@/lib/tenants/store");
    const spy = vi.spyOn(config, "loadTenantConfig");
    spy.mockReturnValue({
      ...loadRealConfig("vitea"),
      allowedOrigins: ["https://mesa.com"],
    } as never);

    const res = await GET(req("?tenant=vitea", { origin: "https://sitio-no-autorizado.com" }));

    expect(res.status).toBe(403);
    expect(limiter.hits).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("isOriginAllowed", () => {
  it("sin origins declarados permite cualquiera", async () => {
    const { isOriginAllowed } = await import("@/lib/tenants/model");
    expect(isOriginAllowed([], "https://cualquiera.com")).toBe(true);
  });

  it("con origins declarados solo permite los listados", async () => {
    const { isOriginAllowed } = await import("@/lib/tenants/model");
    const allowed = ["https://mesa.com", "https://www.mesa.com"];
    expect(isOriginAllowed(allowed, "https://mesa.com")).toBe(true);
    expect(isOriginAllowed(allowed, "https://WWW.MESA.COM")).toBe(true);
    expect(isOriginAllowed(allowed, "https://otro.com")).toBe(false);
  });

  it("con origins declarados rechaza la ausencia de Origin", async () => {
    const { isOriginAllowed } = await import("@/lib/tenants/model");
    expect(isOriginAllowed(["https://mesa.com"], null)).toBe(false);
  });
});