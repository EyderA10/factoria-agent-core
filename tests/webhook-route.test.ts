import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhooks/elevenlabs/route";

const WEBHOOK_SECRET = "whsec_test";

/**
 * Estado de la persistencia simulada. Modela lo que importa para idempotencia:
 * `messages` NO tiene restricción de unicidad, así que insertar dos veces duplica.
 * `events.dedupe_key` sí es único y por eso es el que evita el duplicado.
 */
const db = vi.hoisted(() => ({
  messages: [] as { convRowId: number; role: string; text: string }[],
  events: [] as { type: string; dedupeKey: string | null }[],
  conversations: [] as { id: number; convId: string; tenantId: string }[],
  dedupeKeys: new Set<string>(),
  nextConvId: 1,
  calls: { messages: 0, conversationInserts: 0, conversationUpdates: 0 },
}));

vi.mock("@/lib/db/repo", () => ({
  getAgentByElevenlabsId: async (elevenlabsAgentId: string) =>
    elevenlabsAgentId === "agent_mesa" ? { tenantId: "mesa-y-cia" } : null,
  getConversationByConvId: async (convId: string) => {
    const row = db.conversations.find((c) => c.convId === convId);
    return row ? { id: row.id, tenantId: row.tenantId } : null;
  },
  createConversation: async (params: { convId: string; tenantId: string }) => {
    db.calls.conversationInserts += 1;
    const existing = db.conversations.find((c) => c.convId === params.convId);
    if (existing) return [];
    const row = { id: db.nextConvId++, convId: params.convId, tenantId: params.tenantId };
    db.conversations.push(row);
    return [row];
  },
  updateConversation: async () => {
    db.calls.conversationUpdates += 1;
  },
  insertMessages: async (rows: typeof db.messages) => {
    db.calls.messages += 1;
    db.messages.push(...rows);
  },
  insertEventOnce: async (params: { eventType: string; dedupeKey: string | null }) => {
    if (params.dedupeKey !== null && db.dedupeKeys.has(params.dedupeKey)) {
      return { inserted: false };
    }
    if (params.dedupeKey !== null) db.dedupeKeys.add(params.dedupeKey);
    db.events.push({ type: params.eventType, dedupeKey: params.dedupeKey });
    return { inserted: true, id: db.events.length };
  },
}));

function sign(rawBody: string, timestamp: number) {
  const t = String(Math.floor(timestamp / 1000));
  const v0 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v0=${v0}`;
}

function post(body: unknown, opts: { ts?: number; signature?: string | null } = {}) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== null) {
    headers["elevenlabs-signature"] = opts.signature ?? sign(rawBody, opts.ts ?? Date.now());
  }
  return POST(
    new NextRequest("http://localhost/api/webhooks/elevenlabs", {
      method: "POST",
      headers,
      body: rawBody,
    })
  );
}

function transcriptionEvent(eventTimestamp: number, conversationId = "conv_abc") {
  return {
    type: "post_call_transcription",
    event_timestamp: eventTimestamp,
    conversation_id: conversationId,
    agent_id: "agent_mesa",
    metadata: { user_id: "user_1" },
    data: {
      conversation_id: conversationId,
      status: "completed",
      transcript: [
        { role: "user", message: "Quiero una mesa para dos", time_in_call_secs: 3 },
        { role: "agent", message: "Claro, la mesa t1 está libre", time_in_call_secs: 8 },
      ],
      metadata: { cost: { total_cost_usd: 0.03 } },
    },
  };
}

beforeEach(() => {
  process.env.ELEVENLABS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  db.messages = [];
  db.events = [];
  db.conversations = [];
  db.dedupeKeys = new Set();
  db.nextConvId = 1;
  db.calls = { messages: 0, conversationInserts: 0, conversationUpdates: 0 };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/webhooks/elevenlabs · verificación de firma", () => {
  it("firma válida: persiste la transcripción y devuelve 200", async () => {
    const res = await post(transcriptionEvent(1_700_000_000_000));

    expect(res.status).toBe(200);
    expect(db.messages).toHaveLength(2);
    expect(db.messages[0]).toMatchObject({ role: "user", text: "Quiero una mesa para dos" });
    expect(db.conversations).toHaveLength(1);
    expect(db.events).toHaveLength(1);
  });

  it("firma inválida: 400 y no persiste nada", async () => {
    const res = await post(transcriptionEvent(1_700_000_000_000), {
      signature: "t=1700000000,v0=deadbeef",
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_signature");
    expect(db.messages).toHaveLength(0);
    expect(db.events).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
  });


  it("timestamp expirado (fuera de la ventana de 30 min): 400", async () => {
    const tooOld = Date.now() - 31 * 60 * 1000;
    const res = await post(transcriptionEvent(1_700_000_000_000), { ts: tooOld });

    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("tolerancia");
    expect(db.messages).toHaveLength(0);
  });


  it("sin ELEVENLABS_WEBHOOK_SECRET el endpoint queda deshabilitado (503)", async () => {
    delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    const res = await post(transcriptionEvent(1_700_000_000_000));

    expect(res.status).toBe(503);
    process.env.ELEVENLABS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
});

describe("POST /api/webhooks/elevenlabs · idempotencia", () => {
  it("el mismo evento dos veces no duplica mensajes", async () => {
    const event = transcriptionEvent(1_700_000_000_000);

    const first = await post(event);
    const second = await post(event);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);

    expect(db.messages).toHaveLength(2);
    expect(db.calls.messages).toBe(1);
    expect(db.events).toHaveLength(1);
  });

  it("el reintento no crea una segunda conversación ni la actualiza dos veces", async () => {
    const event = transcriptionEvent(1_700_000_000_000);

    await post(event);
    await post(event);

    expect(db.conversations).toHaveLength(1);
    expect(db.calls.conversationUpdates).toBe(1);
  });

  it("un evento distinto de la misma conversación NO se descarta", async () => {
    await post(transcriptionEvent(1_700_000_000_000));
    await post(transcriptionEvent(1_700_000_000_500));

    expect(db.events).toHaveLength(2);
    expect(db.messages).toHaveLength(4);
  });

});