import { createHash, timingSafeEqual } from "node:crypto";
import { getTenantsForAuth } from "@/lib/db/repo";

/**
 * Resolución segura de tenant desde backend.
 *
 * El core NO confía en el `tenant_id` que el LLM envíe en el body: se resuelve el
 * tenant comparando el Authorization (Bearer) contra el hash del secret de cada
 * tenant (almacenado en la tabla `tenants`). El tenant_id del payload, si llega,
 * se valida contra el tenant resuelto.
 */

const BEARER_PREFIX = "Bearer ";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) return null;
  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export interface ResolvedTenant {
  tenantId: string;
  enabled: boolean;
}

/** Resuelve el tenant desde el header Authorization (Bearer) comparando hashes. */
export async function resolveTenantFromAuth(authHeader: string | null | undefined): Promise<ResolvedTenant | null> {
  const bearer = extractBearer(authHeader);
  if (!bearer) return null;
  const hash = hashSecret(bearer);
  const rows = await getTenantsForAuth();
  for (const row of rows) {
    if (row.secretHash && safeEqualHex(hash, row.secretHash)) {
      return { tenantId: row.id, enabled: row.enabled };
    }
  }
  return null;
}