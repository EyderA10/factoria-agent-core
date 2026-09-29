import { NextRequest, NextResponse } from "next/server";
import { resolveTenantFromAuth } from "@/lib/tenants/resolver";
import { loadTenantConfig } from "@/lib/tenants/store";
import { executeTool } from "@/lib/tools";
import { insertToolCall } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FactorIA Tool Layer — Dispatcher multi-tenant.
 *
 * POST /api/tools/[toolName]
 *
 * 1. Resuelve el tenant desde el header Authorization (Bearer) comparando el hash
 *    del secret de cada tenant (nunca confía en el tenant_id del body).
 * 2. Valida el payload con el contrato Zod del tenant para esa tool.
 * 3. Ejecuta el handler (lógica genérica + settings del tenant, o fetch externo).
 * 4. Persiste el tool_call (observabilidad) y responde para el LLM.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ toolName: string }> }) {
  const { toolName } = await params;
  const startedAt = Date.now();
  const agentId = req.nextUrl.searchParams.get("agent") ?? null;

  try {
    // --- 1. Resolución de tenant desde backend ---
    const allowLocalSkip = process.env.NODE_ENV !== "production" && req.nextUrl.searchParams.get("skipAuth") === "1";
    let tenantId: string | null = null;

    if (allowLocalSkip) {
      tenantId = req.nextUrl.searchParams.get("tenant") ?? null;
      if (!tenantId) {
        return NextResponse.json(
          { error: "Invalid dev request", reason: "skipAuth requiere ?tenant=<id>" },
          { status: 400 }
        );
      }
    } else {
      const tenant = await resolveTenantFromAuth(req.headers.get("authorization"));
      if (!tenant) {
        return NextResponse.json({ error: "Unauthorized: invalid FactorIA Tenant Secret" }, { status: 401 });
      }
      if (!tenant.enabled) {
        return NextResponse.json({ error: "Tenant deshabilitado" }, { status: 403 });
      }
      tenantId = tenant.tenantId;
    }

    // --- 2. Config del tenant + ejecución del contrato ---
    let tenant;
    try {
      tenant = loadTenantConfig(tenantId);
    } catch {
      return NextResponse.json({ error: "Unknown tenant", reason: "config no disponible" }, { status: 404 });
    }

    const rawBody = await req.text();
    const result = await executeTool(tenant, toolName, rawBody);

    const latencyMs = Date.now() - startedAt;

    switch (result.status) {
      case "tool_not_found": {
        await persistToolCall({ req, tenantId, agentId, toolName, rawBody, ok: false, latencyMs, error: "tool_not_found" });
        return NextResponse.json({ error: "Unknown tool", reason: `el tenant no tiene la tool ${toolName}` }, { status: 404 });
      }
      case "invalid_payload": {
        await persistToolCall({ req, tenantId, agentId, toolName, rawBody, ok: false, latencyMs, error: result.reason });
        const status = result.reason === "invalid_json" ? 400 : 400;
        return NextResponse.json({ error: "Invalid payload", reason: result.reason, details: result.details }, { status });
      }
      case "error": {
        await persistToolCall({ req, tenantId, agentId, toolName, rawBody, ok: false, latencyMs, error: result.code });
        return NextResponse.json({ error: "Tool execution error", code: result.code }, { status: 500 });
      }
      case "ok": {
        await persistToolCall({ req, tenantId, agentId, toolName, rawBody, ok: true, latencyMs, response: result.data });
        return NextResponse.json({ success: true, data: result.data });
      }
    }
  } catch (error) {
    console.error("[FactorIA Tool Layer] error:", error);
    return NextResponse.json({ error: "Internal tool execution error" }, { status: 500 });
  }
}

async function persistToolCall(params: {
  req: NextRequest;
  tenantId: string;
  agentId: string | null;
  toolName: string;
  rawBody: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  response?: Record<string, unknown>;
}) {
  try {
    await insertToolCall({
      tenantId: params.tenantId,
      agentId: params.agentId,
      toolName: params.toolName,
      requestJson: JSON.parse(params.rawBody || "{}"),
      responseJson: params.response,
      ok: params.ok,
      latencyMs: params.latencyMs,
      errorJson: params.error ? { code: params.error } : undefined,
    });
  } catch (error) {
    console.error("[FactorIA Tool Layer] persistToolCall error:", error);
  }
}