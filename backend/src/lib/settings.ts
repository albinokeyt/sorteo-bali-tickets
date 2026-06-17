// Ajustes editables del email, guardados en la tabla `settings` (clave/valor).
// Se siembran por defecto la primera vez (desde emailDefault.ts y/o variables
// de entorno) y luego se editan desde el panel admin sin redesplegar.
import { pool } from "../db";
import { config } from "../config";
import { DEFAULT_EMAIL } from "./emailDefault";

export type EmailSettings = {
  from_email: string;
  from_name: string;
  subject: string;
  preheader: string;
  whatsapp_url: string;
  html: string;
};

const KEYS: (keyof EmailSettings)[] = [
  "from_email",
  "from_name",
  "subject",
  "preheader",
  "whatsapp_url",
  "html",
];

// Valores iniciales: prioriza variables de entorno si existen, si no el default.
function seedValues(): EmailSettings {
  return {
    from_email: config.brevo.fromEmail || DEFAULT_EMAIL.from_email,
    from_name: config.brevo.fromName || DEFAULT_EMAIL.from_name,
    subject: process.env.EMAIL_SUBJECT || DEFAULT_EMAIL.subject,
    preheader: process.env.EMAIL_PREHEADER || DEFAULT_EMAIL.preheader,
    whatsapp_url: process.env.WHATSAPP_URL || DEFAULT_EMAIL.whatsapp_url,
    html: DEFAULT_EMAIL.html,
  };
}

// Inserta los valores por defecto solo si la clave no existe todavía.
export async function ensureDefaultSettings() {
  const seed = seedValues();
  for (const key of KEYS) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [`email.${key}`, seed[key]]
    );
  }
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key LIKE 'email.%'`
  );
  const map = new Map(rows.map((r) => [r.key.replace("email.", ""), r.value]));
  const seed = seedValues();
  const out = {} as EmailSettings;
  for (const key of KEYS) out[key] = map.get(key) ?? seed[key];
  return out;
}

export async function saveEmailSettings(patch: Partial<EmailSettings>) {
  for (const key of KEYS) {
    if (patch[key] === undefined) continue;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`email.${key}`, patch[key]]
    );
  }
}
