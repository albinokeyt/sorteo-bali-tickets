// Worker: consume la cola, construye el email con los tickets de la
// compra y lo manda por Brevo. Con limitador de velocidad y reintentos.
// Puedes levantar varios (docker compose up -d --scale worker=4).
import { UnrecoverableError, Worker } from "bullmq";
import { config, QUEUE_NAME } from "./config";
import { connection, enqueueSend, sendQueue, type SendTicketsJob } from "./queue";
import { pool } from "./db";
import { getPurchaseForEmail, markPurchaseEmail } from "./lib/tickets";
import { BrevoError, sendEmail } from "./lib/brevo";
import { buildSubject, buildHtml, type RenderVars } from "./lib/emailTemplate";
import { getEmailSettings } from "./lib/settings";
import { resolvePublicUrl } from "./lib/publicUrl";
import { prerenderTicketImages } from "./lib/ticketImage";

const worker = new Worker<SendTicketsJob>(
  QUEUE_NAME,
  async (job) => {
    const { purchaseId } = job.data;
    const data = await getPurchaseForEmail(purchaseId);
    if (!data) {
      // La compra ya no existe (¿reset?). No reintentar.
      return { skipped: true };
    }
    if (data.purchase.email_status === "sent") {
      return { alreadySent: true };
    }
    if (data.tickets.length === 0) {
      await markPurchaseEmail(purchaseId, "failed", "Sin tickets");
      return { skipped: true };
    }

    // Deja generadas (en segundo plano) las imágenes que lleva el email, para
    // que el pico de aperturas se sirva desde el disco y no tumbe la API.
    prerenderTicketImages(
      data.tickets
        .slice(0, config.brevo.maxTicketImages)
        .map((t) => ({ number: t.number, name: t.name, email: t.email }))
    );

    const name = data.purchase.name as string;
    const email = data.purchase.email as string;
    const settings = await getEmailSettings();
    const baseUrl = await resolvePublicUrl();
    const vars: RenderVars = {
      name,
      email,
      raffleName: data.purchase.raffle_name as string,
      product: data.purchase.product as string | null,
      linkAcceso: data.purchase.link_acceso as string | null,
      tickets: data.tickets.map((t) => ({ number: t.number, code: t.code })),
    };
    const subject = buildSubject(settings, vars);
    const html = buildHtml(settings, vars, baseUrl);

    // Modo simulación: marca enviado sin llamar a Brevo (pruebas de carga).
    if (config.brevo.dryRun) {
      await markPurchaseEmail(purchaseId, "sent");
      return { dryRun: true };
    }

    try {
      const messageId = await sendEmail({
        to: { email, name },
        from: { email: settings.from_email, name: settings.from_name },
        subject,
        html,
        tags: ["ticket", data.purchase.raffle_slug as string],
      });
      await markPurchaseEmail(purchaseId, "sent");
      return { messageId };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // 4xx de Brevo (email inválido, remitente no verificado, clave mala…):
      // reintentar no sirve → 'failed' ya, recuperable con "Reenviar fallidos".
      const permanent = err instanceof BrevoError && err.permanent;
      // Si es el último intento, marcamos failed; si no, BullMQ reintenta.
      if (permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await markPurchaseEmail(purchaseId, "failed", msg);
      }
      throw permanent ? new UnrecoverableError(msg) : err;
    }
  },
  {
    connection,
    concurrency: Math.max(1, config.brevo.ratePerSec),
    limiter: { max: Math.max(1, config.brevo.ratePerSec), duration: 1000 },
  }
);

worker.on("completed", (job) => {
  console.log(`[worker] enviado purchase=${job.data.purchaseId}`);
});
worker.on("failed", (job, err) => {
  console.error(
    `[worker] fallo purchase=${job?.data.purchaseId} intento=${job?.attemptsMade}/${job?.opts.attempts}: ${err?.message}`
  );
});
// Evita que un error de conexión transitorio tumbe el proceso del worker.
worker.on("error", (err) => {
  console.warn(`[worker] error (reintentando): ${err?.message}`);
});

// --- Barrido de seguridad -------------------------------------------------
// Compras que siguen 'pending' sin trabajo en la cola (p. ej. Redis caído
// justo al recibir el webhook, o un trabajo que se quedó colgado) se
// re-encolan solas. enqueueSend no duplica lo que ya está en cola.
let sweeping = false;
async function sweepPending() {
  if (sweeping) return;
  sweeping = true;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM purchases
        WHERE email_status = 'pending'
          AND created_at < now() - make_interval(mins => $1::int)
        ORDER BY created_at
        LIMIT 1000`,
      [Math.max(1, Math.round(config.brevo.sweepMinutes))]
    );
    let requeued = 0;
    for (const r of rows) {
      if (await enqueueSend(r.id)) requeued++;
    }
    if (requeued > 0) console.warn(`[worker] barrido: ${requeued} compra(s) pendientes re-encoladas`);
  } catch (err: any) {
    console.warn(`[worker] barrido de pendientes falló: ${err?.message}`);
  } finally {
    sweeping = false;
  }
}
const sweepTimer =
  config.brevo.sweepMinutes > 0
    ? setInterval(sweepPending, Math.max(1, config.brevo.sweepMinutes) * 60_000)
    : null;

// --- Apagado ordenado (redeploy de EasyPanel) ------------------------------
// Termina los envíos en curso antes de salir; lo que quede en cola sigue en Redis.
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} recibido: cerrando…`);
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  if (sweepTimer) clearInterval(sweepTimer);
  try {
    await worker.close();
  } catch (e: any) {
    console.warn(`[worker] error al cerrar: ${e?.message}`);
  }
  await sendQueue.close().catch(() => {});
  await connection.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason: any) => {
  console.error(`[worker] promesa rechazada sin capturar: ${reason?.stack ?? reason}`);
});

console.log(
  `[worker] escuchando cola "${QUEUE_NAME}" · ${config.brevo.ratePerSec} emails/seg · ${config.brevo.maxAttempts} intentos` +
    (config.brevo.dryRun ? " · ⚠️ MODO SIMULACIÓN (no envía de verdad)" : "")
);
