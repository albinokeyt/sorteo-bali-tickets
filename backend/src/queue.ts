// Cola de envío de emails (BullMQ sobre Redis).
// El webhook encola un trabajo por cada compra y responde al instante;
// el worker los procesa al ritmo permitido por Brevo. Esto es lo que
// permite recibir 3000 compras de golpe sin caerse ni perder ninguna.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config, QUEUE_NAME } from "./config";

export const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // requerido por BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 200, 5000), // reintenta sin rendirse
});

// IMPORTANTE: manejar 'error' evita que un fallo transitorio de Redis
// (reinicio, DNS aún no listo) tumbe el proceso. Sin esto, el worker
// se cae en bucle y EasyPanel lo marca en gris.
connection.on("error", (err: Error) => {
  console.warn(`[redis] conexión con problemas (reintentando): ${err.message}`);
});
connection.on("ready", () => console.log("[redis] conectado"));

export type SendTicketsJob = {
  purchaseId: string;
};

export const sendQueue = new Queue<SendTicketsJob>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: config.brevo.maxAttempts,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 5_000 }, // conserva las últimas para auditar
    removeOnFail: { count: 10_000 },
  },
});

export async function enqueueSend(purchaseId: string) {
  // jobId = purchaseId hace que reintentos/duplicados no creen 2 trabajos.
  await sendQueue.add(
    "send",
    { purchaseId },
    { jobId: `send:${purchaseId}` }
  );
}
