// Sirve la imagen del ticket con sus datos: GET /t/:file  (ej. /t/123.jpg?k=…)
// Busca el nombre y email del ticket por su número (no van en la URL,
// por privacidad) y los dibuja sobre la plantilla. Se cachea.
// La firma ?k= impide recorrer números para sacar los datos de otros.
import type { FastifyInstance, FastifyReply } from "fastify";
import { pool } from "../db";
import { config } from "../config";
import {
  DEMO_TICKET,
  RenderOverloadedError,
  demoImageKey,
  renderTicketImage,
  safeEqual,
  ticketExt,
  ticketImageKey,
  type TicketData,
} from "../lib/ticketImage";

function fail(reply: FastifyReply, code: number, error: string) {
  // Que ningún proxy de email (Gmail, Outlook…) cachee un error.
  return reply.code(code).header("Cache-Control", "no-store").send({ error });
}

export async function imageRoutes(app: FastifyInstance) {
  app.get("/t/:file", async (req, reply) => {
    // file = "123.jpg" / "123.png" / "123" → extrae el número
    const num = parseInt(String((req.params as any).file), 10);
    if (!Number.isInteger(num) || num <= 0) {
      return fail(reply, 400, "número inválido");
    }
    const q = (req.query ?? {}) as { k?: string; demo?: string };
    const k = String(q.k ?? "");

    let data: TicketData;
    if (q.demo === "1") {
      // Imagen de ejemplo del email de prueba del panel (sin datos reales).
      if (!k || !safeEqual(k, demoImageKey(num))) return fail(reply, 403, "enlace no válido");
      data = { number: num, ...DEMO_TICKET };
    } else {
      const { rows } = await pool.query(
        `SELECT name, email FROM tickets
          WHERE ticket_sequential_number = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [num]
      );
      if (rows.length === 0) {
        return fail(reply, 404, "ticket no encontrado");
      }
      if (config.ticket.requireKey && (!k || !safeEqual(k, ticketImageKey(num, rows[0].email)))) {
        return fail(reply, 403, "enlace no válido");
      }
      data = { number: num, name: rows[0].name, email: rows[0].email };
    }

    try {
      const img = await renderTicketImage(data);
      return reply
        .header("Content-Type", ticketExt === "png" ? "image/png" : "image/jpeg")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(img);
    } catch (err: any) {
      if (err instanceof RenderOverloadedError) {
        req.log.warn("render de tickets saturado: respondiendo 503");
        reply.header("Retry-After", "5");
        return fail(reply, 503, "servidor ocupado, reintenta en unos segundos");
      }
      req.log.error({ err }, "error generando imagen de ticket");
      return fail(reply, 500, "no se pudo generar la imagen");
    }
  });
}
