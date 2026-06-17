// Genera la imagen final del ticket: tu plantilla limpia + los datos
// de la compra escritos encima (Nombre, Correo, #Número), en las
// posiciones medidas sobre la plantilla. Se cachea en disco.
import { promises as fs } from "node:fs";
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

let sizeP: Promise<{ width: number; height: number }> | null = null;
function templateSize() {
  if (!sizeP) {
    sizeP = sharp(config.ticket.template)
      .metadata()
      .then((m) => ({ width: m.width ?? 1672, height: m.height ?? 941 }));
  }
  return sizeP;
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

function cacheKey(d: TicketData): string {
  const h = crypto.createHash("sha1").update(`${d.number}|${d.name}|${d.email}`).digest("hex").slice(0, 10);
  return `ticket-${d.number}-${h}.${ticketExt}`;
}

export async function renderTicketImage(d: TicketData): Promise<Buffer> {
  const cachePath = path.join(config.ticket.cacheDir, cacheKey(d));
  try {
    return await fs.readFile(cachePath);
  } catch {
    /* no cacheado */
  }

  const { width, height } = await templateSize();
  const t = config.ticket;
  const numberText = `${t.numberPrefix}${d.number}`;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${textNode(d.name, t.name.x, t.name.y, fitSize(d.name, t.name.size), t.color, 600)}
    ${textNode(d.email, t.email.x, t.email.y, fitSize(d.email, t.email.size), t.color, 400)}
    ${textNode(numberText, t.number.x, t.number.y, fitSize(numberText, t.number.size), t.numberColor, 700)}
  </svg>`;

  // Paso 1: componer el texto sobre la plantilla a tamaño completo
  // (sharp aplica resize ANTES de composite, por eso se hace en 2 pasos).
  const composited = await sharp(config.ticket.template)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();

  // Paso 2: reducir tamaño (si aplica) y exportar al formato configurado
  let pipe = sharp(composited);
  if (config.ticket.outputWidth > 0) {
    pipe = pipe.resize({ width: config.ticket.outputWidth });
  }
  const buf =
    config.ticket.format === "png"
      ? await pipe.png().toBuffer()
      : await pipe.jpeg({ quality: config.ticket.quality, mozjpeg: true }).toBuffer();

  fs.mkdir(config.ticket.cacheDir, { recursive: true })
    .then(() => fs.writeFile(cachePath, buf))
    .catch(() => {});

  return buf;
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
