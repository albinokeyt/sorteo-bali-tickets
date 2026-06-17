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
import { baseFromRequest, resolvePublicUrl } from "../lib/publicUrl";

function authed(req: FastifyRequest): boolean {
  const h = req.headers.authorization ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return verifyToken(token);
}

export async function adminRoutes(app: FastifyInstance) {
  // --- Login (con límite anti-fuerza-bruta: 8 intentos/min por IP) ---
  app.post(
    "/api/admin/login",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 minute",
          errorResponseBuilder: () => ({
            error: "Demasiados intentos. Espera 1 minuto e inténtalo de nuevo.",
          }),
        },
      },
    },
    async (req, reply) => {
      const pw = String((req.body as any)?.password ?? "");
      if (!checkPassword(pw)) {
        return reply.code(401).send({ error: "contraseña incorrecta" });
      }
      return { token: issueToken() };
    }
  );

  // Middleware: todo lo demás requiere token válido.
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/api/admin/") && req.url !== "/api/admin/login") {
      if (!authed(req)) return reply.code(401).send({ error: "no autorizado" });
    }
  });

  // --- Info del webhook lista para pegar en GHL ---
  app.get("/api/admin/webhook-info", async (req) => {
    // Usa el dominio real desde el que estás viendo el panel (auto), o el resuelto.
    const base = baseFromRequest(req) || (await resolvePublicUrl());
    const token = config.webhook.secret;
    return {
      method: "POST",
      url: `${base}/webhook/ghl`,
      urlWithToken: `${base}/webhook/ghl?token=${encodeURIComponent(token)}`,
      header: { name: "X-Webhook-Token", value: token },
      fields: {
        email: config.webhook.fieldEmail,
        name: config.webhook.fieldName,
        quantity: config.webhook.fieldQuantity,
        link: config.webhook.fieldLink,
        orderId: config.webhook.fieldOrderId,
      },
    };
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

  // --- Compras con sus tickets (vista desglosada por compra) ---
  app.get("/api/admin/purchases", async (req) => {
    const q = String((req.query as any)?.q ?? "").toLowerCase().trim();
    const limit = Math.min(200, Number((req.query as any)?.limit ?? 100));
    const offset = Math.max(0, Number((req.query as any)?.offset ?? 0));
    const where = q
      ? `WHERE lower(p.email) LIKE $1 OR lower(p.name) LIKE $1 OR lower(p.external_order_id) LIKE $1`
      : "";
    const params: any[] = q ? [`%${q}%`, limit, offset] : [limit, offset];
    const { rows } = await pool.query(
      `SELECT p.id, p.external_order_id, p.email, p.name, p.quantity,
              p.email_status, p.created_at,
              COALESCE(json_agg(json_build_object(
                'number', t.ticket_sequential_number,
                'code', t.ticket_number,
                'annulled', t.is_annulled
              ) ORDER BY t.ticket_sequential_number)
                FILTER (WHERE t.id IS NOT NULL), '[]') AS tickets
         FROM purchases p
         LEFT JOIN tickets t ON t.purchase_id = p.id AND t.deleted_at IS NULL
         ${where}
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ${q ? "$2" : "$1"} OFFSET ${q ? "$3" : "$2"}`,
      params
    );
    return { purchases: rows };
  });

  // --- Editar el email de una compra (y de sus tickets) ---
  app.post("/api/admin/purchase-email", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const purchaseId = String(b.purchaseId ?? "");
    const email = String(b.email ?? "").toLowerCase().trim();
    if (!purchaseId || !email.includes("@")) {
      return reply.code(400).send({ error: "purchaseId y email válidos requeridos" });
    }
    await pool.query("UPDATE purchases SET email = $2 WHERE id = $1", [purchaseId, email]);
    await pool.query("UPDATE tickets SET email = $2 WHERE purchase_id = $1", [purchaseId, email]);
    if (b.resend) {
      await pool.query("UPDATE purchases SET email_status='pending' WHERE id=$1", [purchaseId]);
      await enqueueSend(purchaseId);
    }
    return { ok: true };
  });

  // --- Anular / reactivar un ticket ---
  app.post("/api/admin/ticket-annul", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const code = String(b.code ?? "");
    const annulled = b.annulled !== false; // por defecto anula
    if (!code) return reply.code(400).send({ error: "code requerido" });
    await pool.query(
      "UPDATE tickets SET is_annulled = $2 WHERE ticket_number = $1",
      [code, annulled]
    );
    return { ok: true, code, annulled };
  });

  // --- Exportar tickets a CSV (todos, o sin anulados con ?excludeAnnulled=1) ---
  app.get("/api/admin/export.csv", async (req, reply) => {
    const excludeAnnulled = ["1", "true", "yes"].includes(
      String((req.query as any)?.excludeAnnulled ?? "").toLowerCase()
    );
    const { rows } = await pool.query(
      `SELECT t.ticket_sequential_number AS num, t.ticket_number AS codigo,
              t.name AS nombre, t.email, p.external_order_id AS compra,
              p.email_status AS estado_email, t.is_annulled AS anulado,
              t.created_at AS creado
         FROM tickets t JOIN purchases p ON p.id = t.purchase_id
        WHERE t.deleted_at IS NULL
          ${excludeAnnulled ? "AND t.is_annulled = false" : ""}
        ORDER BY t.ticket_sequential_number`
    );
    const esc = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["num", "codigo", "nombre", "email", "compra", "estado_email", "anulado", "creado"];
    const lines = [header.join(",")];
    for (const r of rows) lines.push(header.map((h) => esc((r as any)[h])).join(","));
    const csv = "﻿" + lines.join("\r\n"); // BOM para Excel
    const fname = excludeAnnulled ? "tickets-sin-anulados.csv" : "tickets.csv";
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${fname}"`)
      .send(csv);
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
    const base = baseFromRequest(req) || (await resolvePublicUrl());

    const vars: RenderVars = {
      name: "Nombre de Prueba",
      email: to,
      raffleName: "Viaje a Bali · Jorge Darek",
      product: "Guía Definitiva de Entrenamiento de Fuerza",
      linkAcceso: `${base}/?email=${encodeURIComponent(to)}`,
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
        html: buildHtml(s, vars, base),
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
