// Endpoint que recibe el webhook de compra de GHL.
// Diseño clave para escalar: valida -> crea tickets (idempotente) ->
// encola el email -> responde 200 al instante. El envío real lo hace
// el worker. Así 3000 webhooks a la vez no tumban nada.
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { config } from "../config";
import { createPurchaseWithTickets } from "../lib/tickets";
import { safeEqual } from "../lib/ticketImage";
import { enqueueSend } from "../queue";

// Lee un campo del payload soportando rutas con punto: "contact.email".
function pick(obj: any, path: string): unknown {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function asString(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// Cantidad: valor no numérico o <= 0 → 1 (comportamiento de siempre).
function asQuantity(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const MAX_NAME = 150; // el nombre se dibuja en el ticket
const MAX_EMAIL = 254;
const MAX_LINK = 2048;
const MAX_ORDER_ID = 200;

// Para el log: identifica la compra sin exponer el email completo.
function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  return `${(u ?? "").slice(0, 2)}***@${d ?? ""}`;
}

// Con Redis caído, ioredis deja el comando en espera (no falla): sin este
// tope el webhook se quedaría colgado. Si vence, la compra ya está guardada
// como 'pending' y el trabajo se añadirá solo cuando vuelva Redis (y si no,
// lo recoge el barrido del worker).
const ENQUEUE_TIMEOUT_MS = 5_000;
class EnqueueTimeout extends Error {}
function enqueueWithTimeout(purchaseId: string): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    enqueueSend(purchaseId).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new EnqueueTimeout()), ENQUEUE_TIMEOUT_MS);
    }),
  ]);
}

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhook/ghl", async (req, reply) => {
    // 1) Autenticación por token (header o query)
    const token = String(
      (req.headers["x-webhook-token"] as string) || (req.query as any)?.token || ""
    );
    if (!token || !safeEqual(token, config.webhook.secret)) {
      return reply.code(401).send({ error: "token inválido" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const w = config.webhook;

    const email = asString(pick(body, w.fieldEmail));
    const name = (asString(pick(body, w.fieldName)) || email.split("@")[0]).slice(0, MAX_NAME);
    const rawQty = pick(body, w.fieldQuantity);
    const quantity = asQuantity(rawQty);
    const linkAcceso = asString(pick(body, w.fieldLink)).slice(0, MAX_LINK) || null;
    const product = (w.fieldProduct ? asString(pick(body, w.fieldProduct)).slice(0, 300) : "") || null;
    let orderId = asString(pick(body, w.fieldOrderId)).slice(0, MAX_ORDER_ID);

    if (!email || !email.includes("@") || email.length > MAX_EMAIL) {
      req.log.warn({ orderId: orderId || null }, "webhook rechazado: email ausente o inválido");
      return reply.code(400).send({ error: "email ausente o inválido" });
    }
    if (quantity > w.maxQty) {
      // No se crea nada: revisa el dato en GHL y, si es real, créalos a mano en /admin.
      req.log.error(
        { orderId: orderId || null, email: maskEmail(email), quantity, max: w.maxQty },
        "webhook RECHAZADO: cantidad de tickets por encima del tope (WEBHOOK_MAX_QTY)"
      );
      return reply
        .code(422)
        .send({ error: `cantidad ${quantity} supera el máximo permitido (${w.maxQty})` });
    }
    if (rawQty == null || rawQty === "") {
      req.log.warn({ orderId: orderId || null }, "webhook sin cantidad: se asigna 1 ticket");
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

    let result;
    try {
      result = await createPurchaseWithTickets({
        raffleSlug,
        externalOrderId: orderId,
        email,
        name,
        quantity,
        linkAcceso,
        product,
        rawPayload: body,
      });
    } catch (err: any) {
      req.log.error({ err, orderId }, "error procesando webhook");
      return reply.code(500).send({ error: err?.message ?? "error interno" });
    }

    try {
      if (!result.duplicate) {
        await enqueueWithTimeout(result.purchaseId);
      } else {
        req.log.info(
          { orderId, purchaseId: result.purchaseId, emailStatus: result.emailStatus },
          "webhook duplicado (misma compra): no se crean tickets nuevos"
        );
        // Si el primer intento creó la compra pero no llegó a encolar el email
        // (p. ej. Redis caído), el reintento de GHL lo repara.
        if (result.emailStatus === "pending") await enqueueWithTimeout(result.purchaseId);
      }
    } catch (err: any) {
      if (err instanceof EnqueueTimeout) {
        req.log.warn({ orderId, purchaseId: result.purchaseId }, "Redis lento/caído: email pendiente, se encolará al volver");
        return reply.code(200).send({
          ok: true,
          duplicate: result.duplicate,
          purchaseId: result.purchaseId,
          tickets: result.ticketNumbers,
          queued: false,
        });
      }
      // Los tickets YA están guardados; el email queda 'pending' y el barrido
      // del worker (o "Reenviar pendientes") lo enviará. Devolvemos 500 para
      // que GHL reintente (el reintento será 'duplicate' y re-encolará).
      req.log.error({ err, orderId, purchaseId: result.purchaseId }, "tickets creados pero no se pudo encolar el email");
      return reply.code(500).send({ error: "tickets creados; email pendiente de encolar" });
    }

    return reply.code(200).send({
      ok: true,
      duplicate: result.duplicate,
      purchaseId: result.purchaseId,
      tickets: result.ticketNumbers,
    });
  });
}
