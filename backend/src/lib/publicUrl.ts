// Detección automática de la URL pública.
// La app aprende su dominio del primer request que entra por el proxy
// (EasyPanel/Nginx/Traefik mandan X-Forwarded-Host / X-Forwarded-Proto)
// y lo guarda en `settings`. Así NO hay que configurar PUBLIC_URL a mano.
//
// Precedencia:
//   1) PUBLIC_URL del entorno, si está puesto a un valor "real" (override manual)
//   2) el dominio auto-detectado y guardado en la BD
//   3) http://localhost:3000 (fallback en local)
import type { FastifyRequest } from "fastify";
import { pool } from "../db";
import { config } from "../config";

// Valores que consideramos "sin configurar" (no cuentan como override manual).
const PLACEHOLDERS = new Set([
  "",
  "http://localhost:3000",
  "https://tickets.tudominio.com",
]);

let cached: string | null = null;

function clean(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

// PUBLIC_URL del entorno si es un valor real (no placeholder); si no, null.
export function envPublicUrl(): string | null {
  const v = clean(config.publicUrlEnv || "");
  return PLACEHOLDERS.has(v) ? null : v;
}

// Base (proto://host) deducida de las cabeceras del proxy.
export function baseFromRequest(req: FastifyRequest): string | null {
  const h = req.headers;
  const proto =
    (h["x-forwarded-proto"]?.toString().split(",")[0].trim()) ||
    req.protocol ||
    "http";
  const host = (h["x-forwarded-host"] || h["host"])?.toString().split(",")[0].trim();
  if (!host) return null;
  return clean(`${proto}://${host}`);
}

// URL pública efectiva (para construir enlaces e imágenes en los emails).
export async function resolvePublicUrl(): Promise<string> {
  const env = envPublicUrl();
  if (env) return env;
  if (cached) return cached;
  try {
    const { rows } = await pool.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'public_url'"
    );
    if (rows[0]?.value) {
      cached = clean(rows[0].value);
      return cached;
    }
  } catch {
    /* BD aún no lista */
  }
  return clean(config.publicUrl || "http://localhost:3000");
}

// Guarda el dominio detectado (si no hay override manual y no es local).
export async function rememberPublicUrl(base: string | null): Promise<void> {
  if (!base || envPublicUrl()) return; // override manual gana → no guardamos
  const b = clean(base);
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(b)) return; // ignora local
  if (cached === b) return; // sin cambios
  cached = b;
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('public_url', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [b]
    );
  } catch {
    /* no crítico */
  }
}
