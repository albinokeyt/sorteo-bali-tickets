// Renderiza la plantilla de email (editable) sustituyendo las variables
// {{...}} por los datos reales de la compra.
import type { EmailSettings } from "./settings";
import { ticketExt } from "./ticketImage";
import { config } from "../config";

export type EmailTicket = { number: number; code: string };

export type RenderVars = {
  name: string;
  email: string;
  raffleName: string;
  product?: string | null;
  linkAcceso?: string | null;
  tickets: EmailTicket[];
};

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) =>
    vars[k] !== undefined ? vars[k] : ""
  );
}

// Fila de botones (se muestra también ANTES de los tickets, por si el email
// es largo o el cliente lo recorta: así los CTAs siempre quedan visibles).
function ctaRow(linkAcceso: string, ticketsUrl: string, whatsapp: string): string {
  const btn = (href: string, bg: string, fg: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font:700 13px sans-serif;padding:12px 22px;border-radius:8px;margin:4px;">${label}</a>`;
  return `<div style="text-align:center;margin:4px 0 18px;">
    ${btn(linkAcceso, "#C9A227", "#1a1a18", "📥 Acceder a mis productos")}
    ${btn(ticketsUrl, "#1a1a18", "#ffffff", "🎟️ Ver mis tickets")}
    ${btn(whatsapp, "#25D366", "#ffffff", "💬 WhatsApp")}
  </div>`;
}

// Bloque de tickets: botones arriba + imágenes (más pequeñas y limitadas).
// Si hay más tickets que el límite, muestra un aviso con enlace a la web.
function ticketsHtml(
  tickets: EmailTicket[],
  base: string,
  linkAcceso: string,
  ticketsUrl: string,
  whatsapp: string
): string {
  const max = config.brevo.maxTicketImages;
  const w = config.brevo.ticketImgWidth;
  const shown = tickets.slice(0, max);
  const rest = tickets.length - shown.length;

  const imgs = shown
    .map(
      (t) =>
        `<img src="${base}/t/${t.number}.${ticketExt}" width="${w}" alt="Ticket ${t.number}" style="display:block;width:100%;max-width:${w}px;margin:8px auto;border-radius:8px;" />`
    )
    .join("\n");

  const more =
    rest > 0
      ? `<p style="text-align:center;font:600 14px sans-serif;color:#8a6d1a;margin:14px 0;">
           ➕ Y ${rest} ticket(s) más. Velos todos con el botón <b>“Ver mis tickets”</b>.
         </p>`
      : "";

  return `${ctaRow(linkAcceso, ticketsUrl, whatsapp)}\n${imgs}\n${more}`;
}

function buildVars(s: EmailSettings, v: RenderVars, base: string): Record<string, string> {
  const first = v.tickets[0];
  const ticketsUrl = `${base}/?email=${encodeURIComponent(v.email)}`;
  const linkAcceso = v.linkAcceso || ticketsUrl;
  return {
    name: v.name,
    email: v.email,
    count: String(v.tickets.length),
    raffle_name: v.raffleName,
    product: v.product || v.raffleName,
    confirmation_id: first ? first.code : "",
    ticket_numbers: v.tickets.map((t) => `#${t.number}`).join(", "),
    link_acceso: linkAcceso,
    whatsapp_url: s.whatsapp_url,
    tickets_url: ticketsUrl,
    tickets_html: ticketsHtml(v.tickets, base, linkAcceso, ticketsUrl, s.whatsapp_url),
    preheader: substitute(s.preheader, {
      name: v.name,
      count: String(v.tickets.length),
    }),
  };
}

export function buildSubject(s: EmailSettings, v: RenderVars): string {
  return substitute(s.subject, {
    name: v.name,
    count: String(v.tickets.length),
  });
}

export function buildHtml(s: EmailSettings, v: RenderVars, base: string): string {
  return substitute(s.html, buildVars(s, v, base));
}
