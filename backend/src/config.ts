// Configuración central leída de variables de entorno.
// Todo lo que se pueda ajustar sin tocar código vive aquí.
import os from "node:os";

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Falta la variable de entorno requerida: ${key}`);
  }
  return v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = (process.env[key] ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  return ["1", "true", "yes", "si", "sí", "on"].includes(v);
}

// Núcleos disponibles (para dimensionar el render de imágenes).
const CPUS = Math.max(1, (os as any).availableParallelism?.() ?? os.cpus().length);

export const config = {
  // Valor crudo de PUBLIC_URL (puede estar vacío → se auto-detecta el dominio).
  publicUrlEnv: process.env.PUBLIC_URL ?? "",
  publicUrl: env("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, ""),
  port: num("API_PORT", 3000),
  databaseUrl: env("DATABASE_URL", "postgres://tickets:tickets@db:5432/tickets"),
  redisUrl: env("REDIS_URL", "redis://redis:6379"),

  db: {
    poolMax: num("PG_POOL_MAX", 20),
    // Corta consultas colgadas (evita que un bloqueo agote el pool).
    statementTimeoutMs: num("PG_STATEMENT_TIMEOUT_MS", 60_000),
  },

  // Límite de la búsqueda pública /api/tickets por IP y minuto.
  publicRateLimitPerMin: num("PUBLIC_RATE_LIMIT_PER_MIN", 60),

  brevo: {
    apiKey: env("BREVO_API_KEY", "MISSING"),
    fromEmail: env("EMAIL_FROM", "tickets@example.com"),
    fromName: env("EMAIL_FROM_NAME", "Tickets"),
    subject: env("EMAIL_SUBJECT", "🎟️ Tus tickets del sorteo"),
    ratePerSec: num("EMAIL_RATE_PER_SEC", 10),
    // Con backoff exponencial desde 5 s: 8 intentos ≈ 10 min cubriendo caídas
    // o 429 de Brevo antes de marcar el email como 'failed'.
    maxAttempts: num("EMAIL_MAX_ATTEMPTS", 8),
    // Tiempo máximo de cada llamada a Brevo (evita jobs colgados para siempre).
    timeoutMs: num("BREVO_TIMEOUT_MS", 20_000),
    // Cada cuántos minutos el worker re-encola compras que siguen 'pending'
    // sin trabajo en la cola (p. ej. Redis caído justo al recibir el webhook).
    // 0 = desactivado.
    sweepMinutes: num("EMAIL_SWEEP_MINUTES", 5),
    // Cuántas imágenes de ticket se incrustan en el email como máximo.
    // Si la compra tiene más, se muestran estas y un aviso "+N más" con botón
    // a la web (donde se ven TODAS). Evita emails enormes que se cortan.
    maxTicketImages: num("EMAIL_TICKETS_MAX_IMAGES", 15),
    ticketImgWidth: num("EMAIL_TICKET_IMG_WIDTH", 300),
    // Modo simulación: procesa la cola SIN enviar de verdad por Brevo.
    // Útil para pruebas de carga sin gastar envíos ni dañar la reputación.
    dryRun: (process.env.EMAIL_DRY_RUN ?? "").toLowerCase() === "true",
  },

  webhook: {
    secret: env("WEBHOOK_SECRET", "changeme"),
    fieldEmail: env("GHL_FIELD_EMAIL", "email"),
    fieldName: env("GHL_FIELD_NAME", "full_name"),
    fieldQuantity: env("GHL_FIELD_QUANTITY", "customData.TkComprados"),
    fieldOrderId: env("GHL_FIELD_ORDER_ID", "customData.purchase_id"),
    fieldLink: env("GHL_FIELD_LINK", "customData.LinkAcceso"),
    fieldProduct: env("GHL_FIELD_PRODUCT", ""), // opcional: producto comprado
    defaultRaffleSlug: env("DEFAULT_RAFFLE_SLUG", "viaje-bali"),
    // Tope de tickets por compra del webhook. Un valor mayor se rechaza (422)
    // y se registra en el log: evita que un dato erróneo cree millones de filas.
    maxQty: num("WEBHOOK_MAX_QTY", 1000),
  },

  admin: {
    password: env("ADMIN_PASSWORD", "admin"),
    sessionSecret: env("SESSION_SECRET", "session-secret"),
    // Tope de tickets al crear una compra a mano desde el panel.
    maxQty: num("ADMIN_MAX_QTY", 10_000),
  },

  ticket: {
    template: env("TICKET_TEMPLATE", "/app/assets/ticket-template.png"),
    cacheDir: env("TICKET_CACHE_DIR", "/app/cache"),
    // Formato de salida: jpeg (recomendado, ~40x más ligero) o png.
    format: env("TICKET_FORMAT", "jpeg").toLowerCase() === "png" ? "png" : "jpeg",
    quality: num("TICKET_QUALITY", 82),
    // Ancho de salida en px (0 = tamaño original de la plantilla). 1000 da ~94KB.
    outputWidth: num("TICKET_OUTPUT_WIDTH", 1000),
    // Fuente y color del texto que se escribe sobre el ticket
    font: env("TICKET_FONT", "DejaVu Serif, serif"),
    color: env("TICKET_TEXT_COLOR", "#462303"),
    anchor: env("TICKET_TEXT_ANCHOR", "middle"), // start | middle | end
    // Ancho máximo del texto (px). Si un email es más largo, se reduce el
    // tamaño de fuente automáticamente para que no se salga del ticket.
    maxWidth: num("TICKET_MAX_WIDTH", 880),
    // Línea fija (anuncio del sorteo). Déjala vacía ("") para ocultarla.
    announce: env("TICKET_ANNOUNCE", "GANADOR/GANADORA LUNES 9 DE NOVIEMBRE 2026"),
    announceY: num("TICKET_ANNOUNCE_Y", 572),
    announceSize: num("TICKET_ANNOUNCE_SIZE", 22),
    // Posición y tamaño (plantilla VIAJE A BALI v2). De arriba a abajo:
    // anuncio · Ticket #número · (divisor) · "Nombre | Correo" (una línea)
    number: { x: num("TICKET_NUMBER_X", 836), y: num("TICKET_NUMBER_Y", 618), size: num("TICKET_NUMBER_SIZE", 36) },
    // "contact" = línea combinada Nombre | Correo
    contact: { x: num("TICKET_CONTACT_X", 836), y: num("TICKET_CONTACT_Y", 692), size: num("TICKET_CONTACT_SIZE", 26) },
    contactSep: env("TICKET_CONTACT_SEP", "  |  "),
    numberPrefix: env("TICKET_NUMBER_PREFIX", "Ticket: #"),
    numberColor: env("TICKET_NUMBER_COLOR", "#462303"),
    // Render bajo demanda: cuántas imágenes se generan a la vez como máximo
    // (el resto espera en cola) y cuántas pueden esperar antes de responder 503.
    renderConcurrency: Math.max(1, num("TICKET_RENDER_CONCURRENCY", Math.min(8, Math.max(2, CPUS)))),
    renderMaxQueue: num("TICKET_RENDER_MAX_QUEUE", 2000),
    // El worker pre-genera las imágenes del email en segundo plano para que
    // las aperturas se sirvan del disco.
    prerender: bool("TICKET_PRERENDER", true),
    prerenderConcurrency: Math.max(1, num("TICKET_PRERENDER_CONCURRENCY", 2)),
    // Las URLs /t/N.jpg llevan una firma (?k=) para que nadie pueda recorrer
    // los números y descargar nombre+email de todos los compradores.
    requireKey: bool("TICKET_IMG_REQUIRE_KEY", true),
  },
};

export const QUEUE_NAME = "send-tickets";
