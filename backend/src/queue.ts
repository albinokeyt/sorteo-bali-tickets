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

// Igual que en la conexión: un error de Redis no debe tumbar el proceso.
sendQueue.on("error", (err: Error) => {
  console.warn(`[queue] error de Redis (reintentando): ${err.message}`);
});

// Encola el email de una compra. Devuelve true si se añadió un trabajo nuevo.
//
// OJO (BullMQ): add() con un jobId que YA existe no hace nada, aunque ese
// trabajo esté terminado (completed) o fallido (failed) — se conservan miles
// para auditar. Por eso "Reenviar" y "Reenviar fallidos" no hacían nada:
// si el trabajo anterior ya terminó, se borra y se vuelve a crear. Si sigue
// en cola o en curso, no se duplica.
export async function enqueueSend(purchaseId: string): Promise<boolean> {
  // jobId estable (sin ":" — BullMQ no lo permite) para que reintentos
  // o duplicados no creen 2 trabajos para la misma compra.
  const jobId = `send-${purchaseId}`;
  const existing = await sendQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      try {
        await existing.remove();
      } catch {
        /* bloqueado por otro proceso: el add de abajo no hará nada */
      }
    } else if (state !== "unknown") {
      return false; // waiting / active / delayed…: ya está en marcha
    }
  }
  const job = await sendQueue.add("send", { purchaseId }, { jobId });
  return !!job;
}
