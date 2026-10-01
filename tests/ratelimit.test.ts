import { describe, expect, it, vi, beforeEach } from "vitest";
import { postgresRateLimiter } from "@/lib/ratelimit/postgres";

/**
 * El limiter es la única defensa de coste en el camino público (la sesión) y en el de
 * telefonía (que marca llamadas reales). Si el store falla, NO debe tumbar el
 * endpoint: es preferible servir tráfico sin contabilizar que devolver 500.
 *
 * Se prueba el contrato del puerto (`limiter.ts`), no la semántica SQL de Postgres,
 * que es responsabilidad de la migración. El comportamiento con contador real
 * (bloqueo al superar `max`) está cubierto en el mock de los tests de rutas.
 */
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  rateLimitCounters: {
    scope: "scope",
    key: "key",
    windowStart: "window_start",
    count: "count",
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("RateLimiter · degradación segura", () => {
  it("permite la petición si el store no está disponible", async () => {
    const result = await postgresRateLimiter.hit("tenant", "mesa-y-cia", {
      windowSeconds: 3600,
      max: 60,
    });

    expect(result.blocked).toBe(false);
  });

  it("reporta un retryAfter coherente para que el cliente no martillee", async () => {
    const result = await postgresRateLimiter.hit("ip", "203.0.113.5", {
      windowSeconds: 60,
      max: 10,
    });

    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("expone el límite aplicado para poder reportarlo", async () => {
    const result = await postgresRateLimiter.hit("tenant", "vitea", {
      windowSeconds: 3600,
      max: 30,
    });

    expect(result.limit).toBe(30);
  });
});