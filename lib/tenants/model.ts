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

/**
 * Un origin canónico (`esquema://host[:puerto]`), sin barra final.
 *
 * Se valida y se normaliza en el schema, no en cada consumidor, porque de lo
 * contrario los dos que la usan se desincronizan y fallan en silencio:
 * `isOriginAllowed` compara cadenas exactas (una barra final nunca casa con el
 * `Origin` que manda el navegador) mientras que el comodín de `frame-ancestors`
 * SÍ es válido en CSP (y ampliaría el framing a subdominios que la API seguiría
 * denegando). Con `https://cliente.com/`, que es como se escribe un dominio a
 * mano, el embed no cargaba y no había ningún error que explicara por qué.
 * Al fallar en el schema, el error sale al validar el config, no en producción.
 */
const originSchema = z
  .string()
  .min(1, "el origen no puede estar vacío")
  .superRefine((value, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: "custom", message: `${value}: ${message}` });
    if (value.trim() !== value) fail("no admite espacios al borde");
    if (value.includes("*")) fail("no admite comodines: declara cada subdominio explícito");
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      fail("no es una URL válida");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") fail("solo http o https");
    if (url.username || url.password) fail("no admite credenciales");
    if (url.search || url.hash) fail("no admite query ni fragmento");
    if (url.pathname !== "/") fail("es solo esquema y host: no admitas path");
  })
  .transform((value) => new URL(value).origin);

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
  /**
   * `.strict()` a propósito: una clave mal anidada dentro de `agent` sería
   * descartada en silencio por el comportamiento por defecto de Zod, y el
   * default de `allowedOrigins` la convertiría en "cualquier origen". Con
   * strict, el error aparece al cargar el config en vez de abrir un agujero.
   */
  agent: z
    .object({
      name: z.string().min(1),
      firstMessage: z.string().min(1),
      systemPrompt: z.string().min(1),
      language: z.string().default("es"),
      timezone: z.string().default("America/Bogota"),
      ttsModel: z.string().default("eleven_flash_v2_5"),
      llm: z.string().default("gemini-2.5-flash"),
    })
    .strict(),
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
      /**
       * Destinos de transferencia a humano, en lista blanca y por tenant: el
       * `number` sale de aquí y el LLM nunca elige a quién pasar la llamada.
       * Solo aplica a llamadas; `condition` es el disparador en lenguaje natural.
       */
      transfers: z
        .array(
          z.object({
            number: z.string().regex(/^\+[1-9]\d{7,14}$/, "E.164, p.ej. +573001234567"),
            condition: z.string().min(1),
            transferType: z.enum(["blind", "sip_refer"]).optional(),
            postDialDigits: z.string().max(64).optional(),
          })
        )
        .optional(),
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
 * Origins permitidos para embeber el widget de este tenant (esquema + host, sin
 * path). Es OBLIGATORIA: sin ella el config no valida, para que una clave perdida
 * o mal anidada salte en vez de degradar en silencio.
 *
 * Lista vacía = embed cerrado. Es la postura segura por defecto: un tenant sin
 * dominio declarado no se puede embeber en ninguna web. Se llena con la URL que
 * da el cliente en el onboarding (checklist §6).
 */
  allowedOrigins: z.array(originSchema),
  tools: z.array(toolConfigSchema).min(1),
});

/**
 * ¿El origin de la petición puede embeber el widget de este tenant?
 *
 * Sin cabecera `Origin` la respuesta es `true`: no es una petición desde una web
 * ajena (same-origin o server-to-server), y en un GET same-origin el navegador
 * ni la envía. Para cross-origin sí manda la lista, y vacía bloquea.
 */
export function isOriginAllowed(allowedOrigins: string[], origin: string | null): boolean {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return false;
  return allowedOrigins.some((allowed) => allowed.trim().toLowerCase() === origin.trim().toLowerCase());
}

export type ToolProp = z.infer<typeof toolPropSchema>;
export type ToolConfig = z.infer<typeof toolConfigSchema>;
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type Branding = TenantConfig["branding"];
export type TenantTelephony = NonNullable<TenantConfig["telephony"]>;
export type TenantWhatsApp = NonNullable<TenantConfig["whatsapp"]>;