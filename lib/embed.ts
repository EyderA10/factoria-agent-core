import type { TenantConfig } from "@/lib/tenants/model";

/**
 * Contrato del embed: cómo se comunica la página `/embed/<tenant>` con el
 * `public/embed.js` que vive en la web del cliente.
 *
 * El loader no pide nada a nuestra API: crea un iframe y se limita a dimensionarlo.
 * Todo lo que necesita (branding, sesión) lo resuelve el propio iframe, que corre
 * en nuestro origen. Por eso esta arquitectura no necesita CORS: no hay ninguna
 * petición cross-origin en juego. Lo que sí hay que restringir es quién puede
 * *enmarcarnos*, que es lo de `frame-ancestors`.
 */
export const EMBED_RESIZE_MESSAGE = "factoria-embed:resize";

/**
 * Handshake de arranque. El loader se presenta y dice su propio origen; el iframe
 * solo entonces le publica tamaños.
 *
 * Hace falta porque el `targetOrigin` de `postMessage` es el origen de quien
 * *recibe*, y aquí recibe la web del cliente, no FactorIA. Publicar con nuestro
 * propio origen descartaría el mensaje en silencio y el iframe nunca se adjustsaría.
 */
export const EMBED_INIT_MESSAGE = "factoria-embed:init";

/** px. El loader aplica el tamaño que le envíe el iframe; estos son solo los valores iniciales. */
export const EMBED_DEFAULT_WIDTH = 352;
export const EMBED_LAUNCHER_SIZE = 56;

/**
 * `frame-ancestors` sale de la misma `allowedOrigins` que usa la API, para que no
 * haya dos listas que se puedan desincronizar.
 *
 * `[]` produce `'none'`: con el embed cerrado ningún sitio de terceros puede
 * enmarcarnos, que es el estado por defecto de un tenant sin onboarding web.
 *
 * Deliberadamente NO se manda `X-Frame-Options`. Su directiva `ALLOW-FROM` está
 * obsoleta y sin soporte, así que lo único que serviría sería `DENY`, que rompería
 * justo los orígenes que sí queremos admitir.
 */
export function frameAncestors(config: Pick<TenantConfig, "allowedOrigins">): string {
  const origins = config.allowedOrigins.map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) return "'none'";
  return ["'self'", ...origins].join(" ");
}

/**
 * Cabeceras de la página `/embed/<tenant>`.
 *
 * `microphone=(self)` es imprescindible: sin ella el navegador deniega
 * `getUserMedia` dentro de un iframe de origen cruzado, que es justo el caso del
 * embed. El sitio del cliente tiene que permitirlo en su propia respuesta; esto
 * solo cubre nuestra parte.
 */
export function embedSecurityHeaders(config: Pick<TenantConfig, "allowedOrigins">): Record<string, string> {
  return {
    "Content-Security-Policy": `frame-ancestors ${frameAncestors(config)}`,
    "Permissions-Policy": "microphone=(self)",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}