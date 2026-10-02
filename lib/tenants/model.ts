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
  /**
   * Canal telefónico. Opcional: si no está, el tenant no tiene llamadas salientes
   * y `/api/telephony/outbound-call` responde 503 para él.
   *
   * `agentPhoneNumberId` es el id del número importado en ElevenLabs (p. ej. Twilio),
   * NO el número en texto. Se resuelve server-side desde aquí para que el consumidor
   * no pueda elegir de qué número salimos. El import del número lo hace ElevenLabs
   * por dashboard; el core solo lo referencia.
   */
  telephony: z
    .object({
      agentPhoneNumberId: z.string().min(1),
    })
    .optional(),
  /**
   * Canal WhatsApp saliente. Opcional: si no está, el tenant no puede enviar
   * mensajes y `/api/messaging/whatsapp/outbound-message` responde 503 para él.
   *
   * `phoneNumberId` es el id del número de WhatsApp en ElevenLabs (registrado por
   * el cliente en su cuenta de Meta y vinculado al agente), NO el número en texto.
   * Igual que en telefonía se resuelve server-side para que el consumidor no pueda
   * elegir desde qué número sale el mensaje.
   *
   * `templates` es la lista blanca de plantillas del tenant: el consumidor del
   * endpoint nombra una CLAVE de este mapa y nunca el nombre real de Meta. Motivo:
   * las plantillas se aprueban por WABA, así que una WABA suele tener varias
   * (confirmación, recordatorio, promoción) y sin esta lista blanca el consumidor
   * podría enviar cualquiera de ellas. El config declara a qué plantillas tiene
   * derecho el tenant, igual que hace con sus tools.
   */
  whatsapp: z
    .object({
      phoneNumberId: z.string().min(1),
      templates: z
        .record(
          z.string().min(1).regex(/^[a-z0-9_]+$/, "clave de plantilla en snake_case"),
          z.object({
            /** Nombre de la plantilla tal como figura aprobada en Meta. */
            name: z.string().min(1),
            /** Idioma de la plantilla aprobada; no lo elige el consumidor. */
            languageCode: z.string().min(2).max(10),
          })
        )
        .refine((t) => Object.keys(t).length > 0, "declara al menos una plantilla"),
    })
    .optional(),
  /**
   * Origins permitidos para embeber el widget (esquema + host, sin path). Vacío o
   * ausente = no se restringe el origen, pensado para desarrollo.
   */
  allowedOrigins: z.array(z.string().min(1)).default([]),
  tools: z.array(toolConfigSchema).min(1),
});

/** Origin permitido de un tenant. Vacío = cualquier origen (solo desarrollo). */
export function isOriginAllowed(allowedOrigins: string[], origin: string | null): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.some((allowed) => allowed.trim().toLowerCase() === origin.trim().toLowerCase());
}

export type ToolProp = z.infer<typeof toolPropSchema>;
export type ToolConfig = z.infer<typeof toolConfigSchema>;
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type Branding = TenantConfig["branding"];
export type TenantTelephony = NonNullable<TenantConfig["telephony"]>;
export type TenantWhatsApp = NonNullable<TenantConfig["whatsapp"]>;