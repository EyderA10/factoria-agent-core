import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getElevenLabsClient, hasElevenLabsApiKey } from "@/lib/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OutboundCallSchema = z.object({
  agentId: z.string().min(1),
  agentPhoneNumberId: z.string().min(1).describe("ID del número Twilio/SIP importado en ElevenLabs"),
  toNumber: z.string().min(1).describe("Número destino en formato E.164, p.ej. +573001234567"),
});

/**
 * Telefonía outbound: factoría → API ElevenLabs → Twilio → destino.
 * Demuestra qué se puede provisionar vía API. Requiere un número Twilio importado
 * y un agente con mensaje inicial configurado.
 */
export async function POST(req: NextRequest) {
  if (!hasElevenLabsApiKey()) {
    return NextResponse.json(
      {
        error: "not_configured",
        hint: "Configura ELEVENLABS_API_KEY. Para outbound necesitas además un número Twilio importado en ElevenLabs (Phone Numbers).",
      },
      { status: 503 }
    );
  }

  const parsed = OutboundCallSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { agentId, agentPhoneNumberId, toNumber } = parsed.data;
    console.log(`[FactorIA] outbound call agent=${agentId} from=${agentPhoneNumberId} to=${toNumber}`);

    const response = await getElevenLabsClient().conversationalAi.twilio.outboundCall({
      agentId,
      agentPhoneNumberId,
      toNumber,
    });

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error("[FactorIA] outbound call error:", error);
    return NextResponse.json(
      { error: "outbound_call_failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}