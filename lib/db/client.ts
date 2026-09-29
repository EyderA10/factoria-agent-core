import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Cliente de la capa de persistencia (Supabase Postgres via transaction pooler).
 * `prepare: false` es obligatorio con el pooler de Supabase en Transaction mode.
 */
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL no está configurada (transaction pooler de Supabase, puerto 6543)");
}

export const client = postgres(databaseUrl, { prepare: false, max: 1 });
export const db = drizzle(client, { schema });

/** Cierra el pool. Necesario en CLI/scripts: sin esto el proceso no termina. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

export { schema };