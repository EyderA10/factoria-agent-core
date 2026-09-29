import { z } from "zod";

/**
 * Modelo de configuración de un tenant (fuente de verdad).
 *
 * Este schema es el ÚNICO modelo de tenant del core (pedido del CEO: la CLI y un
 * futuro panel deben alimentar el MISMO modelo). La config vive en
 * `config/tenants/<id>.json`. Aquí NO cabe lógica de negocio de ningún cliente:
 * los datos/reglas de cada tenant van en `data` y en `tools`.
 */

export const toolPropSchema = z.object({
  type: z.union([
    z.literal("string"),
    z.literal("integer"),
    z.literal("number"),
    z.literal("boolean"),
    z.array(z.string()),
  ]),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

export const toolConfigSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "nombre de tool en snake_case"),
  description: z.string().min(1),
  inputSchema: z.object({
    properties: z.record(z.string(), toolPropSchema),
    required: z.array(z.string()).default([]),
  }),
  /** Config/parámetros del negocio que la tool necesita (precios, catálogo, geo…). */
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const tenantConfigSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  auth: z.object({
    /** Nombre de la env var donde vive el secret Bearer del tenant (el valor nunca va en el repo). */
    secretRef: z.string().min(1),
  }),
  branding: z.object({
    title: z.string().min(1),
    tagline: z.string().default(""),
    primaryColor: z.string().default("#4f46e5"),
    icon: z.string().default("🤖"),
  }),
  agent: z.object({
    name: z.string().min(1),
    firstMessage: z.string().min(1),
    systemPrompt: z.string().min(1),
    language: z.string().default("es"),
    timezone: z.string().default("America/Bogota"),
    ttsModel: z.string().default("eleven_flash_v2_5"),
    llm: z.string().default("gemini-2.5-flash"),
  }),
  tools: z.array(toolConfigSchema).min(1),
});

export type ToolProp = z.infer<typeof toolPropSchema>;
export type ToolConfig = z.infer<typeof toolConfigSchema>;
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type Branding = TenantConfig["branding"];