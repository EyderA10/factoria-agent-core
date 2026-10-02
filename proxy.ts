import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { embedSecurityHeaders } from "@/lib/embed";
import { listTenantIds, loadTenantConfig } from "@/lib/tenants/store";

/**
 * Cabeceras de `/embed/<tenant>`.
 *
 * `frame-ancestors` depende del tenant, así que no puede ser un `headers()` estático
 * en `next.config.ts`: se resuelve aquí leyendo el mismo config que usa el resto de
 * la app. La lista es exactamente `allowedOrigins`, la misma que valida la API de
 * sesión, para que no haya dos listas que se desincronicen.
 *
 * Next 16 corre este archivo (antes `middleware.ts`) en el runtime de Node, que es
 * lo que permite leer el config del disco.
 */
export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  // Un tenant desconocido no llega a renderizar (la página responde 404), pero
  // mientras tanto también queda sin poder ser enmarcado.
  const tenantId = request.nextUrl.pathname.split("/")[2] ?? "";
  const known = tenantId !== "" && listTenantIds().includes(tenantId);
  const tenant = known ? loadTenantConfig(tenantId) : { allowedOrigins: [] };

  for (const [name, value] of Object.entries(embedSecurityHeaders(tenant))) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: "/embed/:path*",
};