import { NextRequest, NextResponse } from "next/server";
import { sessionForAgent } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint que el widget FactorIA llama antes de iniciar una conversación.
 * - Con ELEVENLABS_API_KEY → devuelve un signed URL (agente privado, sin exponer la key).
 * - Sin API key pero con agent público (o agentId en query) → devuelve el agentId.
 * - Sin configuración → 503 con instrucciones para que el widget muestre el estado "no configurado".
 *
 * GET /api/elevenlabs/session?agentId=agent_xxx
 * GET /api/elevenlabs/session?tenant=vitea   (resuelve el agente del tenant en DB)
 */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  const tenantId = req.nextUrl.searchParams.get("tenant") ?? undefined;

  try {
    const session = await sessionForAgent(agentId, tenantId);
    return NextResponse.json(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[session] error:", message);

    if (message === "agent_id_required") {
      return NextResponse.json(
        {
          error: "not_configured",
          hint: "Pasa ?tenant=<id> o ?agentId=.... Crea el agente del tenant con `npm run setup -- --tenant <id>`.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "elevenlabs_error", hint: "Revisa ELEVENLABS_API_KEY en .env.local", detail: message },
      { status: 500 }
    );
  }
}