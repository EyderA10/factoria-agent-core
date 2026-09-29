import { z } from "zod";
import type { TenantConfig, ToolConfig } from "@/lib/tenants/model";

/** Contexto con el que se ejecuta una tool (el tenant resuelto desde backend). */
export interface ToolContext {
  tenant: TenantConfig;
}

export type ToolResult =
  | {
      ok: true;
      data: Record<string, unknown>;
    }
  | {
      ok: false;
      code: string;
      detail?: unknown;
    };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface ToolDefinition {
  name: string;
  description: string;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export type ParsedToolInput =
  | {
      ok: true;
      input: Record<string, unknown>;
    }
  | {
      ok: false;
      reason: "invalid_json" | "validation_failed";
      details?: unknown;
    };

/** Construye un schema Zod a partir del inputSchema JSON del tenant (== contrato único). */
export function buildZodSchema(toolConfig: ToolConfig): z.ZodType<Record<string, unknown>> {
  const shape: Mutable<z.ZodRawShape> = {};
  const required = new Set(toolConfig.inputSchema.required ?? []);
  for (const [key, prop] of Object.entries(toolConfig.inputSchema.properties ?? {})) {
    let field: z.ZodType;
    if (Array.isArray(prop.type)) {
      field = z.array(z.string());
    } else {
      switch (prop.type) {
        case "integer":
          field = z.number().int();
          break;
        case "number":
          field = z.number();
          break;
        case "boolean":
          field = z.boolean();
          break;
        default:
          field = z.string();
      }
    }
    if (prop.enum && prop.enum.length > 0) {
      field = z.enum(prop.enum as [string, ...string[]]);
    }
    if (prop.description) field = field.describe(prop.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return z.object(shape);
}

export function parseToolInput(toolConfig: ToolConfig, body: string | unknown): ParsedToolInput {
  let raw: unknown = body;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  }
  const schema = buildZodSchema(toolConfig);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "validation_failed", details: parsed.error.flatten() };
  }
  return { ok: true, input: parsed.data as Record<string, unknown> };
}