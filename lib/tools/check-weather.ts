import { getToolConfig } from "@/lib/tenants/store";
import type { ToolDefinition, ToolContext, ToolResult } from "./types";

type WeatherSettings = {
  name?: string;
  latitude?: number;
  longitude?: number;
  rain_threshold_mm?: number;
};

/**
 * Presupuesto de red para Open-Meteo. Va holgado frente a la latencia normal
 * (~0,8 s), pero por debajo del `response_timeout_secs` de la webhook tool (20 s):
 * si el upstream se cuelga preferimos devolver `external_failed` a dejar la
 * llamada abierta hasta que el proveedor la corte y devuelva un error opaco.
 */
const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * Tool "check_weather" — integración EXTERNA REAL (Open-Meteo, sin API key).
 * Valida el flujo: Agente → FactorIA Tool Layer → fetch HTTP → respuesta → agente.
 * Los datos meteorológicos son reales; la ubicación y el umbral de lluvia son del tenant.
 */
const checkWeather: ToolDefinition = {
  name: "check_weather",
  description: "Consulta el clima real (Open-Meteo) para la ubicación del tenant.",
  handler: async (input, ctx: ToolContext): Promise<ToolResult> => {
    const s = (getToolConfig(ctx.tenant, "check_weather")?.settings ?? {}) as WeatherSettings;
    const latitude = s.latitude ?? 4.711;
    const longitude = s.longitude ?? -74.0721;
    const threshold = s.rain_threshold_mm ?? 1;
    const place = s.name ?? ctx.tenant.name;

    const requestedDate = typeof input.date === "string" && input.date ? input.date : undefined;

    let res: Response;
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${latitude}&longitude=${longitude}` +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=7";
      res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch (error) {
      return {
        ok: false,
        code: "external_failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (!res.ok) {
      return { ok: false, code: "external_error", detail: `Open-Meteo ${res.status}` };
    }

    const body = (await res.json()) as {
      daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[] };
    };
    const daily = body.daily ?? {};

    const today = new Date().toISOString().slice(0, 10);
    const target = requestedDate ?? today;
    const idx = (daily.time ?? []).indexOf(target);
    const fallback = Math.max(0, (daily.time ?? []).findIndex((t) => t >= today));
    const i = idx >= 0 ? idx : (fallback >= 0 ? fallback : 0);

    const temperatureMax = daily.temperature_2m_max?.[i] ?? null;
    const precipitationMm = daily.precipitation_sum?.[i] ?? null;
    const weatherCode = daily.weather_code?.[i] ?? null;
    const dateOut = daily.time?.[i] ?? target;

    const goodWeather = weatherCode !== null && weatherCode < 60 && (precipitationMm ?? 0) <= threshold;
    return {
      ok: true,
      data: {
        location: place,
        date: dateOut,
        temperature_max_c: temperatureMax,
        precipitation_mm: precipitationMm,
        weather_code: weatherCode,
        terrace_recommended: goodWeather,
        message: goodWeather
          ? `El clima en ${place} el ${dateOut} es bueno (${temperatureMax}°C, ${precipitationMm} mm de lluvia). La terraza es buena idea.`
          : `El clima en ${place} el ${dateOut} no acompaña (${temperatureMax}°C, ${precipitationMm} mm de lluvia). Mejor interior.`,
      },
    };
  },
};

export default checkWeather;