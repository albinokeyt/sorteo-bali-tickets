// API del panel de administración.
// Protegida por token Bearer emitido tras login con ADMIN_PASSWORD.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../db";
import { config } from "../config";
import { checkPassword, issueToken, verifyToken } from "../lib/auth";
import { createPurchaseWithTickets } from "../lib/tickets";
import { enqueueSend } from "../queue";
import { clearImageCache } from "../lib/ticketImage";
import { getEmailSettings, saveEmailSettings, type EmailSettings } from "../lib/settings";
import { buildHtml, buildSubject, type RenderVars } from "../lib/emailTemplate";
import { sendEmail } from "../lib/brevo";

function authed(req: FastifyRequest): boolean {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return verifyToken(token);
}

export async function adminRoutes(app: FastifyInstance) {
  // --- Login ---
  app.post("/api/admin/login", async (req, reply) => {
    const pw = String((req.body as any)?.password ?? "");
    if (!checkPassword(pw)) {
      return reply.code(401).send({ error: "contraseña incorrecta" });
    }
    return { token: issueToken() };
  });

  // Middleware: todo lo demás requiere token válido.
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/admin/") && req.url !== "/api/admin/login") {
      if (!authed(req)) return reply.code(401).send({ error: "no autorizado" });
    }
  });

  // --- Estadísticas ---
  app.get("/api/admin/stats", async () => {
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*) FROM tickets   WHERE deleted_at IS NULL) AS tickets,
        (SELECT count(*) FROM purchases)                          AS purchases,
        (SELECT count(*) FROM purchases WHERE email_status='sent')   AS sent,
        (SELECT count(*) FROM purchases WHERE email_status='pending') AS pending,
        (SELECT count(*) FROM purchases WHERE email_status='failed')  AS failed
    `);
    return rows[0];
  });

  // --- Listado / búsqueda de tickets (paginado) ---
  app.get("/api/admin/tickets", async (req) => {
    const q = String((req.query as any)?.q ?? "").toLowerCase().trim();
    const limit = Math.min(200, Number((req.query as any)?.limit ?? 100));
    const offset = Math.max(0, Number((req.query as any)?.offset ?? 0));
    const where = q ? `WHERE lower(t.email) LIKE $1 OR lower(t.name) LIKE $1` : "";
    const params = q ? [`%${q}%`, limit, offset] : [limit, offset];
    const { rows } = await pool.query(
      `SELECT t.ticket_number, t.ticket_sequential_number, t.email, t.name,
              t.status, t.created_at, p.email_status, p.id AS purchase_id
         FROM tickets t JOIN purchases p ON p.id = t.purchase_id
         ${where}
        ORDER BY t.ticket_sequential_number DESC
        LIMIT ${q ? "$2" : "$1"} OFFSET ${q ? "$3" : "$2"}`,
      params
    );
    return { tickets: rows };
  });

  // --- Crear tickets manualmente (1 compra, N tickets) ---
  app.post("/api/admin/tickets", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const email = String(b.email ?? "").trim();
    const name = String(b.name ?? "").trim() || email.split("@")[0];
    const quantity = Math.max(1, Math.floor(Number(b.quantity ?? 1)));
    const send = b.send !== false; // por defecto manda el email
    if (!email.includes("@")) return reply.code(400).send({ error: "email inválido" });

    const result = await createPurchaseWithTickets({
      raffleSlug: b.raffle || config.webhook.defaultRaffleSlug,
      externalOrderId: `manual-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      email,
      name,
      quantity,
    });
    if (send && !result.duplicate) await enqueueSend(result.purchaseId);
    return { ok: true, ...result };
  });

  // --- Reenviar el email de una compra ---
  app.post("/api/admin/resend", async (req, reply) => {
    const purchaseId = String((req.body as any)?.purchaseId ?? "");
    if (!purchaseId) return reply.code(400).send({ error: "purchaseId requerido" });
    await pool.query("UPDATE purchases SET email_status='pending' WHERE id=$1", [purchaseId]);
    await enqueueSend(purchaseId);
    return { ok: true };
  });

  // --- Reenviar TODOS los pendientes/fallidos ---
  app.post("/api/admin/resend-failed", async () => {
    const { rows } = await pool.query(
      "SELECT id FROM purchases WHERE email_status IN ('failed','pending')"
    );
    for (const r of rows) await enqueueSend(r.id);
    return { ok: true, requeued: rows.length };
  });

  // --- Ajustes del email (editar HTML, remitente, asunto, preview) ---
  app.get("/api/admin/email-settings", async () => {
    return await getEmailSettings();
  });

  app.post("/api/admin/email-settings", async (req) => {
    const b = (req.body ?? {}) as Partial<EmailSettings>;
    await saveEmailSettings(b);
    return { ok: true, settings: await getEmailSettings() };
  });

  // Envía un email de PRUEBA con datos de ejemplo a la dirección indicada.
  app.post("/api/admin/email-test", async (req, reply) => {
    const b = (req.body ?? {}) as { to?: string } & Partial<EmailSettings>;
    const to = String(b.to ?? "").trim();
    if (!to.includes("@")) return reply.code(400).send({ error: "email de prueba inválido" });

    // Usa los settings guardados, pero permite previsualizar cambios sin guardar.
    const saved = await getEmailSettings();
    const s: EmailSettings = { ...saved, ...b };

    const vars: RenderVars = {
      name: "Nombre de Prueba",
      email: to,
      raffleName: "Viaje a Bali · Jorge Darek",
      product: "Guía Definitiva de Entrenamiento de Fuerza",
      linkAcceso: `${config.publicUrl}/?email=${encodeURIComponent(to)}`,
      tickets: [
        { number: 101, code: "TK-000101" },
        { number: 102, code: "TK-000102" },
      ],
    };
    try {
      await sendEmail({
        to: { email: to, name: vars.name },
        from: { email: s.from_email, name: s.from_name },
        subject: buildSubject(s, vars),
        html: buildHtml(s, vars),
        tags: ["test"],
      });
      return { ok: true };
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message ?? "error enviando" });
    }
  });

  // --- RESET: limpiar un sorteo entero (tickets + compras + contador) ---
  app.post("/api/admin/reset", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const slug = String(b.raffle ?? config.webhook.defaultRaffleSlug);
    if (b.confirm !== "RESET") {
      return reply.code(400).send({ error: 'Debes enviar confirm:"RESET"' });
    }
    await pool.query("SELECT reset_raffle($1)", [slug]);
    await clearImageCache();
    return { ok: true, raffle: slug };
  });
}
