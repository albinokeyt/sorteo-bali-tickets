// Configuración central leída de variables de entorno.
// Todo lo que se pueda ajustar sin tocar código vive aquí.

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

export const config = {
  // Valor crudo de PUBLIC_URL (puede estar vacío → se auto-detecta el dominio).
  publicUrlEnv: process.env.PUBLIC_URL ?? "",
  publicUrl: env("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, ""),
  port: num("API_PORT", 3000),
  databaseUrl: env("DATABASE_URL", "postgres://tickets:tickets@db:5432/tickets"),
  redisUrl: env("REDIS_URL", "redis://redis:6379"),

  brevo: {
    apiKey: env("BREVO_API_KEY", "MISSING"),
    fromEmail: env("EMAIL_FROM", "tickets@example.com"),
    fromName: env("EMAIL_FROM_NAME", "Tickets"),
    subject: env("EMAIL_SUBJECT", "🎟️ Tus tickets del sorteo"),
    ratePerSec: num("EMAIL_RATE_PER_SEC", 10),
    maxAttempts: num("EMAIL_MAX_ATTEMPTS", 4),
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
  },

  admin: {
    password: env("ADMIN_PASSWORD", "admin"),
    sessionSecret: env("SESSION_SECRET", "session-secret"),
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
    announce: env("TICKET_ANNOUNCE", "GANADOR/GANADORA VIERNES 3 DE JULIO 2026"),
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
  },
};

export const QUEUE_NAME = "send-tickets";
