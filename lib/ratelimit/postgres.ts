import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimitCounters } from "@/lib/db/schema";
import type { RateLimiter, RateLimitResult, RateLimitRule, RateLimitScope } from "./limiter";

/**
 * Implementación Postgres del rate limiter.
 *
 * El contador se incrementa con `INSERT ... ON CONFLICT DO UPDATE`, que es atómico:
 * no hace falta transacción explícita ni `SELECT` previo. Dos peticiones
 * concurrentes de la misma clave incrementan el mismo contador sin pisarse.
 *
 * Limpieza: al abrir una ventana nueva (`count` vuelve a 1) se borran las ventanas
 * vencidas de esa misma clave. Así el coste es una fila por clave y ventana, sin
 * cron ni job de mantenimiento: la tabla no crece sin límite.
 */

const CLEANUP_HORIZON_SECONDS = 24 * 60 * 60;

function windowStartFor(now: Date, windowSeconds: number): Date {
  const sizeMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / sizeMs) * sizeMs);
}

export const postgresRateLimiter: RateLimiter = {
  async hit(scope: RateLimitScope, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = new Date();
    const windowStart = windowStartFor(now, rule.windowSeconds);
    const windowEnd = windowStart.getTime() + rule.windowSeconds * 1000;

    try {
      const rows = await db
        .insert(rateLimitCounters)
        .values({ scope, key, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitCounters.scope, rateLimitCounters.key, rateLimitCounters.windowStart],
          set: { count: sql`${rateLimitCounters.count} + 1` },
        })
        .returning({ count: rateLimitCounters.count });

      const count = rows[0]?.count ?? 1;

      if (count === 1) {
        const horizon = new Date(now.getTime() - CLEANUP_HORIZON_SECONDS * 1000);
        await db
          .delete(rateLimitCounters)
          .where(
            and(
              eq(rateLimitCounters.scope, scope),
              eq(rateLimitCounters.key, key),
              lt(rateLimitCounters.windowStart, horizon)
            )
          );
      }

      return {
        count,
        blocked: count > rule.max,
        limit: rule.max,
        retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now.getTime()) / 1000)),
      };
    } catch (error) {
      console.error("[rate-limit] store no disponible, se permite la petición:", error);
      return { count: 0, blocked: false, limit: rule.max, retryAfterSeconds: rule.windowSeconds };
    }
  },
};

/**
 * IP del cliente para el bucket de abuso.
 *
 * `x-forwarded-for` lo fija el proxy de Vercel y llega con formato `cliente, proxy1,
 * proxy2...`: el primero es el que nos interesa. Se usa solo como clave de bucketing
 * para el rate limit, nunca para autorizar, así que un header manipulado solo
 * degrada al propio atacante.
 *
 * Sin header (llamada local, tests, curl directo) cae a `"unknown"` y comparte cubo.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}