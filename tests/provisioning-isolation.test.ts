import { describe, expect, it, vi, beforeEach } from "vitest";
import { provisionTenant, validateTenant } from "@/lib/provisioning/service";

/**
 * Estado compartido del "workspace de ElevenLabs" simulado.
 *
 * Reproduce lo que el provisioning persiste en el workspace (secrets, tools, agentes)
 * para poder comprobar el aislamiento entre tenants cuando dos clientes usan la misma
 * tool. Sin red: el cliente del SDK y el fetch global están mockeados.
 */
const h = vi.hoisted(() => {
  type Tool = { id: string; name: string; secretId: string; url: string };
  return {
    tools: [] as Tool[],
    agents: [] as { id: string; name: string }[],
    secrets: [] as { secretId: string; name: string; value: string }[],
    dbTenants: new Map<string, { id: string }>(),
    dbAgents: new Map<string, { elevenlabsAgentId: string }>(),
    secretHashes: new Map<string, string>(),
    upserts: [] as string[],
    calls: [] as string[],
    agentPatches: [] as any[],
    apiKey: true,
    seq: 0,
    nextId(prefix: string) {
      h.seq += 1;
      return `${prefix}_${h.seq}`;
    },
  };
});

vi.mock("@/lib/tenants/store", () => ({
  loadTenantConfig: (id: string) => TENANTS[id],
  listTenantIds: () => Object.keys(TENANTS),
  loadAllTenantConfigs: () => Object.values(TENANTS),
  getToolConfig: (tenantId: string, toolName: string) =>
    TENANTS[tenantId]?.tools.find((t: { name: string }) => t.name === toolName),
}));

vi.mock("@/lib/db/repo", () => ({
  getTenantById: async (id: string) => h.dbTenants.get(id) ?? null,
  getAgentForTenant: async (id: string) => h.dbAgents.get(id) ?? null,
  upsertTenant: async (tenant: { id: string }) => {
    h.dbTenants.set(tenant.id, tenant);
    h.upserts.push(`tenant:${tenant.id}`);
  },
  upsertAgent: async (agent: { tenantId: string; elevenlabsAgentId: string }) => {
    h.dbAgents.set(agent.tenantId, { elevenlabsAgentId: agent.elevenlabsAgentId });
    h.upserts.push(`agent:${agent.tenantId}`);
  },
  setTenantSecretHash: async (id: string, hash: string) => {
    h.secretHashes.set(id, hash);
  },
}));

vi.mock("@/lib/elevenlabs", () => ({
  getElevenLabsClient: () => {
    if (!h.apiKey) throw new Error("ELEVENLABS_API_KEY no está configurada");
    return sdk;
  },
  hasElevenLabsApiKey: () => h.apiKey,
}));

// --- Cliente del SDK (tools + secrets) -------------------------------------
const sdk = {
  conversationalAi: {
    tools: {
      list: async () => ({
        tools: h.tools.map((t) => ({
          id: t.id,
          toolConfig: {
            type: "webhook",
            name: t.name,
            apiSchema: { requestHeaders: { Authorization: { secretId: t.secretId } } },
          },
        })),
        hasMore: false,
      }),
      create: async ({
        toolConfig,
      }: {
        toolConfig: {
          name: string;
          apiSchema?: { url?: string; requestHeaders?: { Authorization?: { secretId?: string } } };
        };
      }) => {
        const tool = {
          id: h.nextId("tool"),
          name: toolConfig.name,
          secretId: toolConfig.apiSchema?.requestHeaders?.Authorization?.secretId ?? "",
          url: toolConfig.apiSchema?.url ?? "",
        };
        h.tools.push(tool);
        h.calls.push(`tools.create:${tool.name}`);
        return { id: tool.id };
      },
    },
    secrets: {
      list: async () => ({ secrets: h.secrets, hasMore: false }),
      create: async ({ name, value }: { name: string; value: string }) => {
        const secretId = h.nextId("secret");
        h.secrets.push({ secretId, name, value });
        h.calls.push(`secrets.create:${name}`);
        return { secretId };
      },
      update: async (secretId: string, { value }: { value: string }) => {
        const s = h.secrets.find((x) => x.secretId === secretId);
        if (s) s.value = value;
        return {};
      },
    },
  },
};

// --- REST (agentes): el provisioning usa fetch contra api.elevenlabs.io ------
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      h.calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path.endsWith("/v1/convai/agents/create")) {
        const body = JSON.parse(String(init?.body)) as { name: string; conversation_config: any };
        const agent = { id: h.nextId("agent"), name: body.name };
        h.agents.push(agent);
        return jsonResponse({ agent_id: agent.id });
      }
      if (init?.method === "PATCH" && path.includes("/v1/convai/agents/")) {
        h.agentPatches.push(JSON.parse(String(init.body)).conversation_config);
        return jsonResponse({});
      }
      // El agente vivo ya tiene una system tool puesta a mano en el dashboard.
      if (init?.method === "GET" && /\/v1\/convai\/agents\/[^/]+$/.test(path)) {
        return jsonResponse({
          conversation_config: { agent: { prompt: { built_in_tools: { end_call: { type: "system" } } } } },
        });
      }
      return jsonResponse({});
    })
  );
}

// --- Tenants sintéticos: dos restaurantes que comparten reserve_table --------
const reserveTable = (tables: { id: string; seats: number }[]) => ({
  name: "reserve_table",
  description: "Reserva mesa",
  inputSchema: {
    type: "object" as const,
    properties: { date: { type: "string" }, party_size: { type: "number" } },
    required: ["date", "party_size"],
  },
  settings: { tables },
});

const TENANTS: Record<string, any> = {
  "casa-lorena": {
    id: "casa-lorena",
    slug: "casa-lorena",
    enabled: true,
    auth: { secretRef: "FACTORIA_TENANT_CASA_LORENA_SECRET" },
    branding: { title: "Casa Lorena", tagline: "", primaryColor: "#111", icon: "x" },
    agent: { name: "Asistente", firstMessage: "Hola", systemPrompt: "lorena", language: "es" },
    tools: [reserveTable([{ id: "t1", seats: 4 }])],
  },
  "casa-lorena-tel": {
    id: "casa-lorena-tel",
    slug: "casa-lorena-tel",
    name: "Casa Lorena",
    enabled: true,
    auth: { secretRef: "X" },
    branding: { title: "Casa Lorena", primaryColor: "#000", icon: "x" },
    agent: {
      name: "Casa Lorena Assistant",
      firstMessage: "hola",
      systemPrompt: "eres un ayudante",
      language: "es",
      timezone: "America/Bogota",
      ttsModel: "eleven_flash_v2_5",
      llm: "gemini-2.5-flash",
    },
    allowedOrigins: [],
    tools: [reserveTable([{ id: "t1", seats: 10 }])],
    telephony: {
      agentPhoneNumberId: "pn_1",
      transfers: [{ number: "+573001234567", condition: "pide una persona" }],
    },
  },
  "el-parador": {
    id: "el-parador",
    slug: "el-parador",
    enabled: true,
    auth: { secretRef: "FACTORIA_TENANT_EL_PARADOR_SECRET" },
    branding: { title: "El Parador", tagline: "", primaryColor: "#222", icon: "y" },
    agent: { name: "Asistente", firstMessage: "Hola", systemPrompt: "parador", language: "es" },
    tools: [reserveTable([{ id: "p9", seats: 8 }])],
  },
};

beforeEach(() => {
  h.tools = [];
  h.agents = [];
  h.secrets = [];
  h.dbTenants.clear();
  h.dbAgents.clear();
  h.secretHashes.clear();
  h.upserts = [];
  h.calls = [];
  h.apiKey = true;
  h.seq = 0;
  vi.unstubAllGlobals();
  stubFetch();
});

describe("provisioning: aislamiento de tools por tenant", () => {
  it("dos tenants con la misma tool reciben tools separadas", async () => {
    await provisionTenant("casa-lorena");
    await provisionTenant("el-parador");

    expect(h.tools).toHaveLength(2);
    expect(h.tools.map((t) => t.name)).toEqual([
      "casa-lorena__reserve_table",
      "el-parador__reserve_table",
    ]);
    expect(h.tools[0].secretId).not.toBe(h.tools[1].secretId);
  });

  it("el nombre en ElevenLabs está namespaced por tenant", async () => {
    const result = await provisionTenant("casa-lorena");
    expect(h.calls).toContain("tools.create:casa-lorena__reserve_table");
    expect(h.tools[0].name).toBe("casa-lorena__reserve_table");
    expect(result.toolIds).toEqual([h.tools[0].id]);
  });

  it("la URL del webhook conserva el nombre pelado de la tool", async () => {
    await provisionTenant("casa-lorena");
    // El dispatcher enruta por ruta: namespacear el recurso de ElevenLabs no puede
    // cambiar el contrato público de /api/tools/<tool>.
    expect(h.tools[0].url).toMatch(/\/api\/tools\/reserve_table$/);
    expect(h.tools[0].url).not.toContain("__");
  });

  it("NO reutiliza una tool con el nombre correcto pero secret de otro tenant", async () => {
    await provisionTenant("casa-lorena");
    // Se simula que alguien renombró a mano la tool del parador con el nombre de lorena.
    h.tools[0].name = "casa-lorena__reserve_table";
    const foreign = { id: "tool_fuera", name: "casa-lorena__reserve_table", secretId: "secret_ajeno", url: "" };
    h.tools.push(foreign);

    await provisionTenant("casa-lorena");

    // No la adoptó: el secret_id delata que es de otro tenant.
    expect(h.tools.some((t) => t.id === "tool_fuera" && t.secretId === "secret_ajeno")).toBe(true);
    expect(h.tools.filter((t) => t.name === "casa-lorena__reserve_table")).toHaveLength(2);
  });
});

describe("provisioning: idempotencia", () => {
  it("reprovisionar el mismo tenant reutiliza sus recursos", async () => {
    await provisionTenant("casa-lorena");
    const before = h.tools.length;
    const result = await provisionTenant("casa-lorena");

    expect(h.tools).toHaveLength(before);
    expect(result.plan.find((p) => p.kind === "tool")?.action).toBe("reuse");
  });

  it("el segundo tenant no toca los recursos del primero", async () => {
    await provisionTenant("casa-lorena");
    const [lorena] = h.tools;
    await provisionTenant("el-parador");

    expect(h.tools[0]).toEqual(lorena);
    expect(h.tools[0].secretId).not.toBe(h.tools[1].secretId);
  });
});

describe("provisioning: transferencia a humano", () => {
  it("pone transfer_to_number con los destinos del config sin borrar las tools que ya había", async () => {
    await provisionTenant("casa-lorena-tel");
    await provisionTenant("casa-lorena-tel", { forceUpdateAgent: true });

    const builtIn = h.agentPatches.at(-1)?.agent?.prompt?.built_in_tools;
    expect(Object.keys(builtIn).sort()).toEqual(["end_call", "transfer_to_number"]);
    expect(builtIn.transfer_to_number.params).toEqual({
      system_tool_type: "transfer_to_number",
      transfers: [
        {
          transfer_destination: { type: "phone", phone_number: "+573001234567" },
          condition: "pide una persona",
        },
      ],
    });
  });
});

describe("provisioning: aislamiento de agentes", () => {
  it("dos tenants con el mismo nombre de agente no comparten agente", async () => {
    expect(TENANTS["casa-lorena"].agent.name).toBe(TENANTS["el-parador"].agent.name);

    await provisionTenant("casa-lorena");
    await provisionTenant("el-parador");

    expect(h.agents).toHaveLength(2);
    expect(h.dbAgents.get("casa-lorena")?.elevenlabsAgentId).not.toBe(
      h.dbAgents.get("el-parador")?.elevenlabsAgentId
    );
  });

  it("el agente se resuelve por el id guardado en DB, no por nombre", async () => {
    await provisionTenant("casa-lorena");
    const id = h.dbAgents.get("casa-lorena")?.elevenlabsAgentId;
    expect(id).toBeTruthy();

    const result = await provisionTenant("casa-lorena");
    expect(result.agentId).toBe(id);
    expect(h.agents).toHaveLength(1);
    expect(result.plan.find((p) => p.kind === "agent")?.action).toBe("reuse");
  });
});

describe("provisioning: dry-run sin credenciales", () => {
  it("no lanza sin ELEVENLABS_API_KEY y no llama a ElevenLabs", async () => {
    h.apiKey = false;

    const result = await provisionTenant("casa-lorena", { dryRun: true });

    expect(result.agentId).toBe("(nuevo agente)");
    expect(result.plan.some((p) => p.kind === "tool" && p.action === "create")).toBe(true);
    expect(h.tools).toHaveLength(0);
    expect(h.secrets).toHaveLength(0);
    expect(h.agents).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

});

describe("provisioning: validateTenant", () => {


  it("detecta una tool sin handler en el core", () => {
    const broken = structuredClone(TENANTS["casa-lorena"]);
    broken.tools[0].name = "tool_inexistente";
    TENANTS["broken"] = broken;
    try {
      const check = validateTenant("broken");
      expect(check.ok).toBe(false);
      expect(check.errors.join(" ")).toMatch(/no tiene handler/);
    } finally {
      delete TENANTS["broken"];
    }
  });
});
