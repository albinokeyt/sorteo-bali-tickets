// Sirve la imagen del ticket con sus datos: GET /t/:file  (ej. /t/123.jpg)
// Busca el nombre y email del ticket por su número (no van en la URL,
// por privacidad) y los dibuja sobre la plantilla. Se cachea.
import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { renderTicketImage, ticketExt } from "../lib/ticketImage";

export async function imageRoutes(app: FastifyInstance) {
  app.get("/t/:file", async (req, reply) => {
    // file = "123.jpg" / "123.png" / "123" → extrae el número
    const num = parseInt(String((req.params as any).file), 10);
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
      const img = await renderTicketImage({ number: num, name: rows[0].name, email: rows[0].email });
      return reply
        .header("Content-Type", ticketExt === "png" ? "image/png" : "image/jpeg")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(img);
    } catch (err: any) {
      req.log.error({ err }, "error generando imagen de ticket");
      return reply.code(500).send({ error: "no se pudo generar la imagen" });
    }
  });
}
