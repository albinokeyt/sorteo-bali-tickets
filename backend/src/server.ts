// API + servidor del frontend (mismo origen).
// Monta: webhook GHL, API pública, API admin, imágenes de ticket y la SPA.
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { pool } from "./db";
import { ensureDefaultSettings } from "./lib/settings";
import { baseFromRequest, rememberPublicUrl } from "./lib/publicUrl";
import { webhookRoutes } from "./routes/webhook";
import { imageRoutes } from "./routes/image";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  trustProxy: true, // detrás de un reverse proxy (nginx/traefik) en producción
  bodyLimit: 1_048_576, // 1MB
});

await app.register(fastifyCors, { origin: true });

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
