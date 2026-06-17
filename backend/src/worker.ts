// Worker: consume la cola, construye el email con los tickets de la
// compra y lo manda por Brevo. Con limitador de velocidad y reintentos.
// Puedes levantar varios (docker compose up -d --scale worker=4).
import { Worker } from "bullmq";
import { config, QUEUE_NAME } from "./config";
import { connection, type SendTicketsJob } from "./queue";
import { getPurchaseForEmail, markPurchaseEmail } from "./lib/tickets";
import { sendEmail } from "./lib/brevo";
import { buildSubject, buildHtml, type RenderVars } from "./lib/emailTemplate";
import { getEmailSettings } from "./lib/settings";

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

    const name = data.purchase.name as string;
    const email = data.purchase.email as string;
    const settings = await getEmailSettings();
    const vars: RenderVars = {
      name,
      email,
      raffleName: data.purchase.raffle_name as string,
      product: data.purchase.product as string | null,
      linkAcceso: data.purchase.link_acceso as string | null,
      tickets: data.tickets.map((t) => ({ number: t.number, code: t.code })),
    };
    const subject = buildSubject(settings, vars);
    const html = buildHtml(settings, vars);

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
      // Si es el último intento, marcamos failed; si no, BullMQ reintenta.
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await markPurchaseEmail(purchaseId, "failed", msg);
      }
      throw err;
    }
  },
  {
    connection,
    concurrency: Math.max(1, config.brevo.ratePerSec),
    limiter: { max: config.brevo.ratePerSec, duration: 1000 },
  }
);

worker.on("completed", (job) => {
  console.log(`[worker] enviado purchase=${job.data.purchaseId}`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] fallo purchase=${job?.data.purchaseId}: ${err?.message}`);
});

console.log(
  `[worker] escuchando cola "${QUEUE_NAME}" · ${config.brevo.ratePerSec} emails/seg · ${config.brevo.maxAttempts} intentos`
);
