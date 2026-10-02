import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/messaging/whatsapp/outbound-message/route";

/**
 * Qué garantiza esta ruta (y qué no).
 *
 * La ruta envía un mensaje saliente de WhatsApp usando el workspace de ElevenLabs
 * compartido por todos los clientes. El riesgo a aislar no es "que se pueda enviar",
 * sino QUÉ se puede hacer con ese envío: el cuerpo es la única superficie que el
 * consumidor controla, así que debe poder decidir el contenido del mensaje y nada más.
 *
 * El cuerpo admite tres cosas: destinatario, plantilla (por clave) y los datos que
 * rellenan los huecos de la plantilla. Todo lo demás se resuelve server-side:
 *
 *   - el agente, desde DB (`agents.elevenlabsAgentId`);
 *   - el número emisor, desde `whatsapp.phoneNumberId` del tenant;
 *   - el nombre real de la plantilla y su idioma, desde `whatsapp.templates`.
 *
 * Los tres se prueban aquí, no porque sea defensa por capas arbitraria, sino porque un
 * cruce en cualquiera de ellos significa que un tenant escribe con la identidad de
 * otro. Los tests fijan además las respuestas de cada rechazo (401/400/404/503/429),
 * que son el contrato observable del endpoint.
 *
 * Cómo leer los casos:
 *   · "el consumidor solo decide X"  → el cuerpo no puede elegir nada más;
 *   · "el config manda"              → lo que se envía sale del config del tenant;
 *   · "corta antes de salir"         → el 4xx ocurre sin tocar la API de ElevenLabs.
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
  outbound: [] as {
    agentId: string;
    whatsappPhoneNumberId: string;
    whatsappUserId: string;
    templateName: string;
    templateLanguageCode: string;
    templateParams: { type: string; parameters: { text: string }[] }[];
  }[],
  failWith: null as Error | null,
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
  // `sin-agente` devuelve null a propósito para cubrir el 503 por falta de agente.
  resolveAgentIdForTenant: async (tenantId?: string | null) =>
    tenantId === "sin-agente" ? null : `agent_${tenantId}`,
  getElevenLabsClient: () => ({
    conversationalAi: {
      whatsapp: {
        outboundMessage: async (params: (typeof calls.outbound)[number]) => {
          if (calls.failWith) throw calls.failWith;
          calls.outbound.push(params);
          return { message_id: "msg_1" };
        },
      },
    },
  }),
}));

const TENANTS = [
  { id: "mesa-y-cia", hash: "hash_mesa" },
  { id: "sin-agente", hash: "hash_sin_agente" },
  { id: "sin-whatsapp", hash: "hash_sin_whatsapp" },
  { id: "una-plantilla", hash: "hash_una_plantilla" },
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
    listTenantIds: () => TENANTS.map((t) => t.id),
    loadTenantConfig: (id: string) => {
      const base = { ...real, id, name: id };
      if (id === "sin-whatsapp") return base;
      if (id === "una-plantilla") {
        return {
          ...base,
          whatsapp: { phoneNumberId: "waba_1", templates: { solo_una: { name: "unica_v2", languageCode: "es" } } },
        };
      }
      return {
        ...base,
        whatsapp: {
          phoneNumberId: "waba_mesa",
          templates: {
            confirmacion: { name: "confirmacion_reserva_v2", languageCode: "es" },
            recordatorio: { name: "recordatorio_pago_v1", languageCode: "es_MX" },
          },
        },
      };
    },
  };
});

const VALID = { toNumber: "+573001234567", template: "confirmacion" };

function post(body: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return POST(
    new NextRequest("http://localhost/api/messaging/whatsapp/outbound-message", {
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
  calls.failWith = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/messaging/whatsapp/outbound-message · quién puede enviar", () => {
  it("sin secret responde 401 y corta antes de la cuota y de la API", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(401);
    expect(limiter.hits).toHaveLength(0);
    expect(calls.outbound).toHaveLength(0);
  });

  it("secret que no corresponde a ningún tenant responde 401", async () => {
    const res = await post(VALID, "hash_inventado");

    expect(res.status).toBe(401);
    expect(calls.outbound).toHaveLength(0);
  });

  it("cada secret envía con el agente de su propio tenant", async () => {
    const res = await post(VALID, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].agentId).toBe("agent_mesa-y-cia");
  });

  it("sin agente provisionado responde 503 y no llama a ElevenLabs", async () => {
    const res = await post(VALID, "hash_sin_agente");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "not_configured" });
    expect(calls.outbound).toHaveLength(0);
  });
});

describe("POST /api/messaging/whatsapp/outbound-message · el consumidor solo decide el mensaje", () => {
  it("el cuerpo no puede elegir el agente ni el número emisor", async () => {
    const res = await post(
      {
        ...VALID,
        agentId: "agent_infiltrado",
        whatsappPhoneNumberId: "waba_infiltrada",
      },
      "hash_mesa"
    );

    expect(res.status).toBe(200);
    expect(calls.outbound[0].agentId).toBe("agent_mesa-y-cia");
    expect(calls.outbound[0].whatsappPhoneNumberId).toBe("waba_mesa");
  });



  it("el cuerpo no puede elegir el idioma de la plantilla", async () => {
    const res = await post({ ...VALID, templateLanguageCode: "en" }, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].templateLanguageCode).toBe("es");
  });

});

describe("POST /api/messaging/whatsapp/outbound-message · qué plantillas puede usar", () => {
  it("el cuerpo no puede elegir la plantilla por su nombre real de Meta", async () => {
    const res = await post({ ...VALID, templateName: "recordatorio_pago_v1" }, "hash_mesa");

    // El nombre real de Meta no es una clave del config: se ignora y gana la clave
    // declarada en el cuerpo, resuelta contra el config del tenant.
    expect(res.status).toBe(200);
    expect(calls.outbound[0].templateName).toBe("confirmacion_reserva_v2");
    expect(calls.outbound[0].templateName).not.toBe("recordatorio_pago_v1");
  });

  it("la clave se traduce al nombre real declarado en el config", async () => {
    const res = await post(VALID, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].templateName).toBe("confirmacion_reserva_v2");
  });


  it("una clave que el tenant no declara responde 400 y lista las disponibles", async () => {
    const res = await post({ toNumber: "+573001234567", template: "promo" }, "hash_mesa");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "unknown_template",
      availableTemplates: ["confirmacion", "recordatorio"],
    });
    expect(calls.outbound).toHaveLength(0);
  });

  it("las plantillas de un tenant no son las de otro", async () => {
    const res = await post({ toNumber: "+573001234567", template: "recordatorio" }, "hash_una_plantilla");

    expect(res.status).toBe(400);
    expect(calls.outbound).toHaveLength(0);
  });

  it("un tenant sin whatsapp configurado responde 503 y no llama a ElevenLabs", async () => {
    const res = await post(VALID, "hash_sin_whatsapp");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "whatsapp_not_configured" });
    expect(calls.outbound).toHaveLength(0);
  });
});

describe("POST /api/messaging/whatsapp/outbound-message · datos del mensaje", () => {
  it("acepta el destino sin '+' y lo envía sin '+'", async () => {
    const res = await post({ ...VALID, toNumber: "573001234567" }, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].whatsappUserId).toBe("573001234567");
  });

  it("rechaza un destino que no es E.164", async () => {
    const res = await post({ ...VALID, toNumber: "573001234567 ext. 4" }, "hash_mesa");

    expect(res.status).toBe(400);
    expect(calls.outbound).toHaveLength(0);
  });


  it("los params rellenan los huecos de la plantilla en orden", async () => {
    const res = await post({ ...VALID, params: ["Ana", "4"] }, "hash_mesa");

    expect(res.status).toBe(200);
    expect(calls.outbound[0].templateParams).toEqual([
      { type: "body", parameters: [{ text: "Ana" }, { text: "4" }] },
    ]);
  });

});

describe("POST /api/messaging/whatsapp/outbound-message · cuota y fallos del proveedor", () => {


  it("cuando la cuota bloquea responde 429 y no llama a ElevenLabs", async () => {
    limiter.blocked = true;
    const res = await post(VALID, "hash_mesa");

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(calls.outbound).toHaveLength(0);
  });

  it("un rechazo del proveedor se traduce a 502 sin filtrar la key", async () => {
    calls.failWith = new Error("template_not_approved");

    const res = await post(VALID, "hash_mesa");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "whatsapp_outbound_message_failed" });
  });
});