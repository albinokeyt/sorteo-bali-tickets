// API + servidor del frontend (mismo origen).
// Monta: webhook GHL, API pública, API admin, imágenes de ticket y la SPA.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { pool, runMigrations } from "./db";
import { connection, sendQueue } from "./queue";
import { ensureDefaultSettings } from "./lib/settings";
import { baseFromRequest, rememberPublicUrl } from "./lib/publicUrl";
import { webhookRoutes } from "./routes/webhook";
import { imageRoutes } from "./routes/image";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";

// IP real del cliente: detrás de Traefik/Caddy es el ÚLTIMO tramo de
// X-Forwarded-For (lo añade el proxy). El primero y X-Real-Ip los puede
// inventar el cliente, así que no sirven para limitar.
function clientIp(req: { headers: Record<string, any>; socket?: { remoteAddress?: string } }): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : String(xff ?? "");
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || req.socket?.remoteAddress || "unknown";
}

// Los logs no deben guardar el token del webhook (?token=) ni emails (?email=).
function redactUrl(url: string | undefined): string {
  return String(url ?? "").replace(/([?&](?:token|email|k)=)[^&]*/gi, "$1***");
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    serializers: {
      req(req: any) {
        return {
          method: req.method,
          url: redactUrl(req.url),
          remoteAddress: clientIp(req),
        };
      },
    },
  },
  trustProxy: true, // detrás de un reverse proxy (nginx/traefik) en producción
  bodyLimit: 1_048_576, // 1MB
});

await app.register(fastifyCors, { origin: true });

// Límite de peticiones. global:false → solo afecta a rutas que lo pidan
// (el login), para no estorbar al webhook que puede recibir miles de golpe.
await app.register(fastifyRateLimit, {
  global: false,
  keyGenerator: (req) => clientIp(req as any),
});

// Auto-detección del dominio público: aprende de las cabeceras del proxy
// (EasyPanel) en cada request y lo guarda para que el worker lo use en emails.
app.addHook("onRequest", async (req) => {
  void rememberPublicUrl(baseFromRequest(req));
});

// Salud (para healthchecks / balanceadores)
app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true };
});

// Rutas de la API
await app.register(webhookRoutes);
await app.register(imageRoutes);
await app.register(publicRoutes);
await app.register(adminRoutes);

// Frontend estático (build de Vite). Si no existe, la API igual funciona.
const staticDir = process.env.STATIC_DIR ?? "/app/public";
if (existsSync(path.join(staticDir, "index.html"))) {
  await app.register(fastifyStatic, { root: staticDir });
  // SPA fallback: cualquier ruta no-API devuelve index.html
  app.setNotFoundHandler((req, reply) => {
    if (
      req.raw.url?.startsWith("/api") ||
      req.raw.url?.startsWith("/webhook") ||
      req.raw.url?.startsWith("/t/")
    ) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.log.warn(`No se encontró el frontend en ${staticDir} (la API funciona igual).`);
}

const port = config.port;

// Siembra los ajustes de email por defecto si aún no existen (no bloquea el arranque).
ensureDefaultSettings().catch((err) => app.log.warn({ err }, "no se pudieron sembrar settings"));
// Índices que faltan en BDs creadas antes (no bloquea el arranque).
runMigrations()
  .then(() => app.log.info("migraciones OK (índices)"))
  .catch((err) => app.log.warn({ err }, "no se pudieron aplicar las migraciones"));

// Avisos de configuración insegura (no cambian el comportamiento).
for (const [name, val, bad] of [
  ["WEBHOOK_SECRET", config.webhook.secret, ["changeme", "cambia-este-secreto"]],
  ["ADMIN_PASSWORD", config.admin.password, ["admin", "cambia-esta-clave-admin"]],
  ["SESSION_SECRET", config.admin.sessionSecret, ["session-secret", "cambia-este-session-secret"]],
] as const) {
  if ((bad as readonly string[]).includes(val)) app.log.warn(`⚠️ ${name} tiene el valor por defecto: cámbialo en el entorno`);
}

// Apagado ordenado (redeploy): deja terminar las peticiones en curso.
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} recibido: cerrando…`);
  const force = setTimeout(() => process.exit(1), 20_000);
  force.unref();
  await app.close().catch(() => {});
  await sendQueue.close().catch(() => {});
  await connection.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
// Una promesa olvidada no debe tumbar la API en mitad del sorteo.
process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "promesa rechazada sin capturar");
});

app
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    const mode = config.publicUrlEnv ? `PUBLIC_URL=${config.publicUrlEnv}` : "dominio AUTO-detectado del proxy";
    app.log.info(`API escuchando en :${port} · ${mode}`);
    app.log.info(`🔗 Webhook GHL: <TU-DOMINIO>/webhook/ghl  ·  panel: <TU-DOMINIO>/admin (allí ves la URL exacta con token)`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
