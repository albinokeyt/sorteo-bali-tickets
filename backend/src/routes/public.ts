// API pública usada por la página de búsqueda: el cliente pone su email
// y ve sus tickets. Solo lectura.
import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { ticketExt } from "../lib/ticketImage";
import { getEmailSettings } from "../lib/settings";

export async function publicRoutes(app: FastifyInstance) {
  // Config pública para la web (ej. el WhatsApp, editable desde el admin).
  app.get("/api/public-config", async () => {
    const s = await getEmailSettings();
    return { whatsapp_url: s.whatsapp_url };
  });

  app.get("/api/tickets", async (req, reply) => {
    const email = String((req.query as any)?.email ?? "")
      .toLowerCase()
      .trim();
    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "email inválido" });
    }
    const { rows } = await pool.query(
      `SELECT t.ticket_number, t.ticket_sequential_number, t.name, t.status, t.created_at,
              r.name AS raffle_name
         FROM tickets t JOIN raffles r ON r.id = t.raffle_id
        WHERE lower(t.email) = $1 AND t.deleted_at IS NULL AND t.is_annulled = false
        ORDER BY t.ticket_sequential_number`,
      [email]
    );
    // Link de acceso más reciente para este email (botón "Accede a tus productos")
    const link = await pool.query<{ link_acceso: string }>(
      `SELECT link_acceso FROM purchases
        WHERE lower(email) = $1 AND link_acceso IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    return {
      email,
      count: rows.length,
      link_acceso: link.rows[0]?.link_acceso ?? null,
      tickets: rows.map((t) => ({
        ticket_number: t.ticket_number,
        number: Number(t.ticket_sequential_number),
        name: t.name,
        status: t.status,
        created_at: t.created_at,
        raffle_name: t.raffle_name,
        image_url: `/t/${Number(t.ticket_sequential_number)}.${ticketExt}`,
      })),
    };
  });
}
