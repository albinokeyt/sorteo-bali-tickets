// Sirve la imagen del ticket con sus datos: GET /t/:num.png
// Busca el nombre y email del ticket por su número (no van en la URL,
// por privacidad) y los dibuja sobre la plantilla. Se cachea.
import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { renderTicketImage } from "../lib/ticketImage";

export async function imageRoutes(app: FastifyInstance) {
  app.get("/t/:num.png", async (req, reply) => {
    const num = Number((req.params as any).num);
    if (!Number.isInteger(num) || num <= 0) {
      return reply.code(400).send({ error: "número inválido" });
    }
    const { rows } = await pool.query(
      `SELECT name, email FROM tickets
        WHERE ticket_sequential_number = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [num]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: "ticket no encontrado" });
    }
    try {
      const png = await renderTicketImage({ number: num, name: rows[0].name, email: rows[0].email });
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(png);
    } catch (err: any) {
      req.log.error({ err }, "error generando imagen de ticket");
      return reply.code(500).send({ error: "no se pudo generar la imagen" });
    }
  });
}
