/**
 * FactorIA Rate Limiter — puerto de control de abuso y coste.
 *
 * El core depende de esta interface, no de una implementación concreta: Postgres
 * hoy (ver `postgres.ts`), Redis en el futuro si el volumen lo justifica. Cambiar de
 * store es añadir una implementación y una env var, no tocar las rutas.
 *
 * La interface existe por el mismo motivo que la ADR 5 (Redis diferido): no
 * acoplar las rutas a un store que quizá no necesitemos.
 */

export type RateLimitScope = "tenant" | "ip";

export interface RateLimitResult {
  /** Peticiones registradas en la ventana actual, ya incrementada. */
  count: number;
  /** `true` si esta petición ya superó el límite y debe rechazarse. */
  blocked: boolean;
  /** Límite aplicado, para poder reportarlo en la respuesta. */
  limit: number;
  /** Segundos hasta que rota la ventana. */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Ventana de conteo en segundos. */
  windowSeconds: number;
  /** Máximo de peticiones permitidas dentro de la ventana. */
  max: number;
}

export interface RateLimiter {
  /**
   * Registra una petición contra `key` y devuelve si debe permitirse.
   *
   * Debe ser atómico: dos peticiones concurrentes de la misma clave incrementan el
   * mismo contador sin pisarse, y el que excede `max` recibe `blocked: true`.
   * Si el store no está disponible, la implementación debe dejar pasar la petición
   * (`blocked: false`) y no romper la request: es preferible no limitar que no
   * servir tráfico.
   */
  hit(scope: RateLimitScope, key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

/** Reglas por defecto. La capa de IP es más agresiva: frena bucles, no coste. */
export const DEFAULT_RULES = {
  /** Sesiones por tenant y hora: cota de coste de la conversación. */
  sessionPerTenant: { windowSeconds: 3600, max: 60 } satisfies RateLimitRule,
  /** Peticiones por IP y minuto: frena el bucle y el agotamiento de cuota. */
  sessionPerIp: { windowSeconds: 60, max: 10 } satisfies RateLimitRule,
  /** Llamadas salientes por tenant y hora: cada llamada cuesta dinero de verdad. */
  outboundPerTenant: { windowSeconds: 3600, max: 30 } satisfies RateLimitRule,
} as const;