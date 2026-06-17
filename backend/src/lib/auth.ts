// Autenticación simple del panel admin mediante un token firmado (HMAC).
// Sin base de datos de sesiones: el token lleva su propia firma y caducidad.
import crypto from "node:crypto";
import { config } from "../config";

const TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", config.admin.sessionSecret)
    .update(payload)
    .digest("base64url");
}

export function issueToken(): string {
  const exp = Date.now() + TTL_MS;
  const payload = `admin.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expStr, sig] = parts;
  const payload = `${role}.${expStr}`;
  const expected = sign(payload);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return false;
  }
  const exp = Number(expStr);
  return Number.isFinite(exp) && exp > Date.now();
}

// Comparación de contraseña en tiempo constante.
export function checkPassword(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(config.admin.password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
