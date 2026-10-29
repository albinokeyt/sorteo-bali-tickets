// Genera la imagen final del ticket: tu plantilla limpia + los datos
// de la compra escritos encima (Nombre, Correo, #Número), en las
// posiciones medidas sobre la plantilla. Se cachea en disco.
//
// Preparado para picos de aperturas de email:
//  - la plantilla se decodifica UNA vez y se guarda en memoria (raw);
//  - como mucho `renderConcurrency` renders a la vez (el resto espera);
//  - si 20 peticiones piden el mismo ticket a la vez, se renderiza una sola vez;
//  - la caché se escribe de forma atómica (tmp + rename): nunca se sirve
//    un JPEG a medio escribir.
import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { config } from "../config";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type RawTemplate = {
  data: Buffer;
  info: { width: number; height: number; channels: 1 | 2 | 3 | 4 };
};

// Plantilla decodificada una sola vez (evita decodificar el PNG en cada render).
let tplP: Promise<RawTemplate> | null = null;
function template(): Promise<RawTemplate> {
  if (!tplP) {
    tplP = sharp(config.ticket.template)
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => ({
        data,
        info: { width: info.width, height: info.height, channels: info.channels as 1 | 2 | 3 | 4 },
      }))
      .catch((err) => {
        tplP = null; // reintenta en la siguiente petición
        throw err;
      });
  }
  return tplP;
}

// Reduce el tamaño de fuente si el texto es más ancho que maxWidth,
// para que un email largo no se salga del ticket.
function fitSize(text: string, size: number): number {
  const approx = text.length * size * 0.55; // ancho aproximado para una serif
  if (approx <= config.ticket.maxWidth) return size;
  return Math.max(14, Math.floor((size * config.ticket.maxWidth) / approx));
}

function textNode(text: string, x: number, y: number, size: number, color: string, weight = 400) {
  return `<text x="${x}" y="${y}" text-anchor="${config.ticket.anchor}"
    dominant-baseline="middle" fill="${color}" font-weight="${weight}"
    font-family="${config.ticket.font}" font-size="${size}px">${escapeXml(text)}</text>`;
}

export type TicketData = { number: number; name: string; email: string };

export const ticketExt = config.ticket.format === "png" ? "png" : "jpg";

// Huella del diseño: si cambia el anuncio, posiciones, plantilla, etc., las
// imágenes cacheadas de antes (p. ej. de la edición anterior) dejan de usarse.
const renderFingerprint = (() => {
  let tplStamp = "";
  try {
    const st = statSync(config.ticket.template);
    tplStamp = `${st.size}-${Math.floor(st.mtimeMs)}`;
  } catch {
    /* plantilla aún no disponible */
  }
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(config.ticket) + "|" + tplStamp)
    .digest("hex")
    .slice(0, 8);
})();

function cacheKey(d: TicketData): string {
  const h = crypto
    .createHash("sha1")
    .update(`${renderFingerprint}|${d.number}|${d.name}|${d.email}`)
    .digest("hex")
    .slice(0, 12);
  return `ticket-${d.number}-${h}.${ticketExt}`;
}

function cachePathFor(d: TicketData): string {
  return path.join(config.ticket.cacheDir, cacheKey(d));
}

// --- Firma de las URLs de imagen ------------------------------------------
// La imagen lleva nombre y email del comprador: sin firma, cualquiera podría
// recorrer /t/1.jpg, /t/2.jpg… y descargar los datos de todos.
function hmac(text: string): string {
  return crypto
    .createHmac("sha256", config.admin.sessionSecret)
    .update(text)
    .digest("base64url")
    .slice(0, 16);
}

export function ticketImageKey(number: number, email: string): string {
  return hmac(`img|${number}|${String(email).toLowerCase().trim()}`);
}

export function demoImageKey(number: number): string {
  return hmac(`demo|${number}`);
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Ruta relativa (sin dominio) de la imagen de un ticket.
export function ticketImagePath(number: number, email: string): string {
  return `/t/${number}.${ticketExt}?k=${ticketImageKey(number, email)}`;
}

// Ruta de una imagen de EJEMPLO (email de prueba del panel): no usa datos reales.
export function demoImagePath(number: number): string {
  return `/t/${number}.${ticketExt}?demo=1&k=${demoImageKey(number)}`;
}

export const DEMO_TICKET = { name: "Nombre de Prueba", email: "prueba@ejemplo.com" };

// --- Limitador de concurrencia (semáforo con traspaso directo de turno) ----
function makeLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    pending: () => waiting.length,
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((r) => waiting.push(r));
      else active++;
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next) next(); // el turno pasa directamente al siguiente
        else active--;
      }
    },
  };
}

const renderLimiter = makeLimiter(config.ticket.renderConcurrency);
const inflight = new Map<string, Promise<Buffer>>();

export class RenderOverloadedError extends Error {
  constructor() {
    super("demasiadas imágenes en cola");
  }
}

async function readCached(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

let cacheDirReady: Promise<unknown> | null = null;
async function writeCacheAtomic(p: string, buf: Buffer) {
  try {
    if (!cacheDirReady) {
      cacheDirReady = fs.mkdir(config.ticket.cacheDir, { recursive: true }).catch((e) => {
        cacheDirReady = null;
        throw e;
      });
    }
    await cacheDirReady;
    const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, p);
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  } catch {
    /* la caché no es crítica */
  }
}

async function drawTicket(d: TicketData): Promise<Buffer> {
  const tpl = await template();
  const { width, height } = tpl.info;
  const t = config.ticket;
  const numberText = `${t.numberPrefix}${d.number}`;

  const announceNode = t.announce
    ? textNode(t.announce, t.number.x, t.announceY, fitSize(t.announce, t.announceSize), t.color, 400)
    : "";

  // Línea combinada "Nombre | Correo"
  const contactText = `${d.name}${t.contactSep}${d.email}`;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${announceNode}
    ${textNode(numberText, t.number.x, t.number.y, fitSize(numberText, t.number.size), t.numberColor, 700)}
    ${textNode(contactText, t.contact.x, t.contact.y, fitSize(contactText, t.contact.size), t.color, 500)}
  </svg>`;

  // Paso 1: componer el texto sobre la plantilla a tamaño completo
  // (sharp aplica resize ANTES de composite, por eso se hace en 2 pasos).
  // El intermedio va en raw (sin comprimir): mismo resultado, mucho más rápido.
  const composited = await sharp(tpl.data, { raw: tpl.info })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Paso 2: reducir tamaño (si aplica) y exportar al formato configurado
  let pipe = sharp(composited.data, {
    raw: {
      width: composited.info.width,
      height: composited.info.height,
      channels: composited.info.channels as 1 | 2 | 3 | 4,
    },
  });
  if (config.ticket.outputWidth > 0) {
    pipe = pipe.resize({ width: config.ticket.outputWidth });
  }
  return config.ticket.format === "png"
    ? await pipe.png().toBuffer()
    : await pipe.jpeg({ quality: config.ticket.quality, mozjpeg: true }).toBuffer();
}

export async function renderTicketImage(d: TicketData): Promise<Buffer> {
  const cachePath = cachePathFor(d);
  const cached = await readCached(cachePath);
  if (cached) return cached;

  // Mismo ticket ya renderizándose → se comparte el resultado.
  const key = path.basename(cachePath);
  const running = inflight.get(key);
  if (running) return running;

  if (config.ticket.renderMaxQueue > 0 && renderLimiter.pending() >= config.ticket.renderMaxQueue) {
    throw new RenderOverloadedError();
  }

  const p = renderLimiter
    .run(async () => {
      // Puede que el worker (u otra petición) lo haya dejado ya en disco.
      const again = await readCached(cachePath);
      if (again) return again;
      const buf = await drawTicket(d);
      await writeCacheAtomic(cachePath, buf);
      return buf;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Deja la imagen en la caché de disco si aún no está (no devuelve el buffer).
export async function ensureTicketImage(d: TicketData): Promise<void> {
  try {
    await fs.access(cachePathFor(d));
    return;
  } catch {
    /* no está */
  }
  await renderTicketImage(d);
}

// Pre-render en segundo plano (lo usa el worker tras encolar un email):
// así, cuando el cliente abre el email, la imagen ya está en disco.
const prerenderLimiter = makeLimiter(config.ticket.prerenderConcurrency);
const PRERENDER_MAX_BACKLOG = 20_000;
export function prerenderTicketImages(list: TicketData[]): void {
  if (!config.ticket.prerender) return;
  for (const d of list) {
    if (prerenderLimiter.pending() >= PRERENDER_MAX_BACKLOG) return; // se generarán al abrir
    void prerenderLimiter.run(() => ensureTicketImage(d)).catch(() => {});
  }
}

export async function clearImageCache() {
  try {
    const files = await fs.readdir(config.ticket.cacheDir);
    await Promise.all(
      files
        .filter((f) => f.startsWith("ticket-"))
        .map((f) => fs.unlink(path.join(config.ticket.cacheDir, f)).catch(() => {}))
    );
  } catch {
    /* nada */
  }
}
