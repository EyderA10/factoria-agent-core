import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createConversation,
  getAgentByElevenlabsId,
  getConversationByConvId,
  insertEvent,
  insertMessages,
  updateConversation,
} from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post-call webhook entrante de ElevenLabs → FactorIA (persistencia + analítica).
 *
 * ElevenLabs firma cada evento con HMAC-SHA256 — header `elevenlabs-signature`
 * con el formato `t=<timestamp>,v0=<hmac hex del body>` (tolerancia 30 min).
 * El secret se configura en ELEVENLABS_WEBHOOK_SECRET (variable de entorno).
 *
 * AISLAMIENTO MULTI-TENANT: el tenant se resuelve por `agent_id` → agents (DB).
 * Nunca se confía en el body para elegir tenant; si no se puede resolver, se
 * registra el evento sin tenant (queda en la consola para diagnóstico).
 *
 * Eventos persistidos:
 *   - conversation_initiation_metadata_event → conversación creada (agente, user)
 *   - agent_tool_response*                   → evento de tool (args que pidió el LLM)
 *   - post_call_transcription                → transcripción + mensajes + coste
 *   - conversation_ended                     → cierre + coste
 *   - resto                                  → log y discard
 */

const SIGNATURE_HEADER = "elevenlabs-signature";
const TOLERANCE_MS = 30 * 60 * 1000;

function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return `v0=${hmac.digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "not_configured",
        hint: "Configura ELEVENLABS_WEBHOOK_SECRET y luego activa el post-call webhook a nivel de workspace en ElevenLabs.",
      },
      { status: 503 }
    );
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get(SIGNATURE_HEADER);

  if (!signatureHeader) {
    return NextResponse.json({ error: "invalid_signature", detail: "missing signature header" }, { status: 400 });
  }

  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signature = parts.find((p) => p.startsWith("v0="));

  if (!timestamp || !signature) {
    return NextResponse.json({ error: "invalid_signature", detail: "no v0/t signature scheme" }, { status: 400 });
  }

  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Date.now() - tsMs > TOLERANCE_MS || tsMs - Date.now() > 60_000) {
    return NextResponse.json({ error: "invalid_signature", detail: "timestamp fuera de tolerancia" }, { status: 400 });
  }

  const expected = computeSignature(secret, timestamp, rawBody);
  if (!safeEqual(expected, signature)) {
    return NextResponse.json({ error: "invalid_signature", detail: "hmac mismatch" }, { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_payload", detail: "body no es JSON" }, { status: 400 });
  }

  const type = typeof event.type === "string" ? event.type : "unknown";
  const data = (event.data ?? {}) as Record<string, unknown>;
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const convId =
    (typeof event.conversation_id === "string" && event.conversation_id) ||
    (typeof data.conversation_id === "string" ? data.conversation_id : undefined);
  const agentId =
    (typeof event.agent_id === "string" && event.agent_id) ||
    (typeof data.agent_id === "string" ? data.agent_id : undefined);
  const userId = typeof metadata.user_id === "string" ? metadata.user_id : null;

  try {
    // Aislamiento: el tenant sale del agente (DB), nunca del body.
    const tenantId = await resolveTenantId({ agentId, convId });
    const existing = convId ? await getConversationByConvId(convId) : null;

    switch (type) {
      case "conversation_initiation_metadata_event": {
        if (tenantId && convId) {
          const created = await createConversation({
            tenantId,
            convId,
            agentId: agentId ?? existing?.agentId ?? null,
            channel: (metadata.channel as string) ?? "web",
            userId,
            status: "initiated",
          });
          await recordEvent({ tenantId, convId, agentId, type, payload: event });
          console.log(`[ElevenLabs-inbound] initiated tenant=${tenantId} conv=${convId} agent=${agentId ?? "-"} row=${created[0]?.id ?? "exists"}`);
        } else {
          console.warn(`[ElevenLabs-inbound] initiated sin tenant/conv resoluble (agent=${agentId ?? "-"}, conv=${convId ?? "-"})`);
        }
        break;
      }

      case "agent_tool_response":
      case "agent_tool_response_full_payload": {
        const toolName = (event.tool_name as string) ?? data.tool_name ?? null;
        const args = event.tool_call_args ?? data.tool_call_args ?? null;
        await recordEvent({ tenantId, convId, agentId, type, payload: event });
        console.log(
          `[ElevenLabs-inbound] tool_response tenant=${tenantId ?? "-"} conv=${convId ?? "-"} tool=${toolName ?? "-"} payload=${JSON.stringify(args ?? event).slice(0, 400)}`
        );
        break;
      }

      case "post_call_transcription": {
        const dataMeta = (data.metadata ?? {}) as Record<string, unknown>;
        const transcript = Array.isArray(data.transcript)
          ? (data.transcript as { role?: string; message?: string; time_in_call_secs?: number }[])
          : [];
        const cost = (dataMeta.cost ?? data.cost ?? metadata.cost ?? null) as { total_cost_usd?: number } | null;
        const firstUser = transcript.find((m) => m.role === "user")?.message ?? "";

        if (tenantId && convId) {
          const conv = await ensureConversationRow({ tenantId, convId, agentId, existing });
          const rows = transcript
            .map((m) => ({
              role: m.role === "user" ? "user" : "agent",
              text: (m.message ?? "").trim(),
            }))
            .filter((m) => m.text.length > 0)
            .map((m) => ({ convRowId: conv, ...m }));
          await insertMessages(rows);
          await updateConversation(convId, {
            status: (data.status as string) ?? "completed",
            transcriptJson: transcript,
            endedAt: new Date(),
            costUsd: cost?.total_cost_usd != null ? String(cost.total_cost_usd) : null,
          });
        }

        await recordEvent({ tenantId, convId, agentId, type, payload: event });
        console.log(
          `[ElevenLabs-inbound] post_call tenant=${tenantId ?? "-"} conv=${convId ?? "-"} status=${(data.status as string) ?? "-"} lines=${transcript.length} cost=${JSON.stringify(cost ?? null)} user="${firstUser.slice(0, 120)}"`
        );
        break;
      }

      case "conversation_ended": {
        const cost = (metadata.cost ?? data.cost ?? null) as { total_cost_usd?: number } | null;
        if (tenantId && convId) {
          await ensureConversationRow({ tenantId, convId, agentId, existing });
          await updateConversation(convId, {
            status: (event.status as string) ?? "ended",
            endedAt: new Date(),
            costUsd: cost?.total_cost_usd != null ? String(cost.total_cost_usd) : null,
          });
        }
        await recordEvent({ tenantId, convId, agentId, type, payload: event });
        console.log(
          `[ElevenLabs-inbound] conversation_ended tenant=${tenantId ?? "-"} conv=${convId ?? "-"} cost=${JSON.stringify(cost ?? null)}`
        );
        break;
      }

      default: {
        await recordEvent({ tenantId, convId, agentId, type, payload: event });
        console.log(`[ElevenLabs-inbound] ${type} tenant=${tenantId ?? "-"} conv=${convId ?? "-"}`);
      }
    }
  } catch (err) {
    // La persistencia NUNCA debe romper la respuesta del webhook.
    console.error("[ElevenLabs-inbound] persist error:", err);
  }

  return NextResponse.json({ ok: true });
}

async function resolveTenantId(params: { agentId?: string; convId?: string }): Promise<string | null> {
  if (params.agentId) {
    const agent = await getAgentByElevenlabsId(params.agentId);
    if (agent) return agent.tenantId;
  }
  if (params.convId) {
    const conv = await getConversationByConvId(params.convId);
    if (conv) return conv.tenantId;
  }
  return null;
}

async function ensureConversationRow(params: {
  tenantId: string;
  convId: string;
  agentId?: string;
  existing: Awaited<ReturnType<typeof getConversationByConvId>> | null;
}): Promise<number> {
  if (params.existing) return params.existing.id;
  const created = await createConversation({
    tenantId: params.tenantId,
    convId: params.convId,
    agentId: params.agentId ?? null,
    channel: "web",
    status: "active",
  });
  return created[0]?.id ?? (await getConversationByConvId(params.convId))?.id ?? 0;
}

async function recordEvent(params: {
  tenantId: string | null;
  convId?: string;
  agentId?: string;
  type: string;
  payload: Record<string, unknown>;
}) {
  await insertEvent({
    tenantId: params.tenantId,
    conversationId: params.convId ?? null,
    agentId: params.agentId ?? null,
    eventType: params.type,
    payloadJson: params.payload,
  });
}