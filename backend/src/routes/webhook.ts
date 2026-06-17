// Endpoint que recibe el webhook de compra de GHL.
// Diseño clave para escalar: valida -> crea tickets (idempotente) ->
// encola el email -> responde 200 al instante. El envío real lo hace
// el worker. Así 3000 webhooks a la vez no tumban nada.
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { config } from "../config";
import { createPurchaseWithTickets } from "../lib/tickets";
import { enqueueSend } from "../queue";

// Lee un campo del payload soportando rutas con punto: "contact.email".
function pick(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function asString(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function asQuantity(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook/ghl", async (req, reply) => {
    // 1) Autenticación por token (header o query)
    const token =
      (req.headers["x-webhook-token"] as string) ||
      (req.query as any)?.token ||
      "";
    if (token !== config.webhook.secret) {
      return reply.code(401).send({ error: "token inválido" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const w = config.webhook;

    const email = asString(pick(body, w.fieldEmail));
    const name = asString(pick(body, w.fieldName)) || email.split("@")[0];
    const quantity = asQuantity(pick(body, w.fieldQuantity));
    const linkAcceso = asString(pick(body, w.fieldLink)) || null;
    const product = (w.fieldProduct ? asString(pick(body, w.fieldProduct)) : "") || null;
    let orderId = asString(pick(body, w.fieldOrderId));

    if (!email || !email.includes("@")) {
      return reply.code(400).send({ error: "email ausente o inválido" });
    }
    if (!orderId) {
      // GHL no manda un id de compra: derivamos una clave DETERMINISTA del
      // propio payload. Así un reintento de GHL (payload idéntico) se detecta
      // como duplicado, mientras que compras distintas (otra cantidad u otro
      // LinkAcceso) generan una clave distinta.
      // Para idempotencia 100% garantizada, añade customData.purchase_id en GHL.
      orderId =
        "auto-" +
        crypto
          .createHash("sha1")
          .update(`${email}|${quantity}|${linkAcceso ?? ""}`)
          .digest("hex")
          .slice(0, 24);
    }

    const raffleSlug = asString(pick(body, "raffle")) || w.defaultRaffleSlug;

    try {
      const result = await createPurchaseWithTickets({
        raffleSlug,
        externalOrderId: orderId,
        email,
        name,
        quantity,
        linkAcceso,
        product,
        rawPayload: body,
      });

      // Encola el email solo para compras nuevas (los duplicados ya se enviaron).
      if (!result.duplicate) {
        await enqueueSend(result.purchaseId);
      }

      return reply.code(200).send({
        ok: true,
        duplicate: result.duplicate,
        purchaseId: result.purchaseId,
        tickets: result.ticketNumbers,
      });
    } catch (err: any) {
      req.log.error({ err }, "error procesando webhook");
      return reply.code(500).send({ error: err?.message ?? "error interno" });
    }
  });
}
