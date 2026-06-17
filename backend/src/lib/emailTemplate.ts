// Renderiza la plantilla de email (editable) sustituyendo las variables
// {{...}} por los datos reales de la compra.
import type { EmailSettings } from "./settings";
import { ticketExt } from "./ticketImage";

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

// Construye el bloque con la imagen de cada ticket (plantilla + datos).
function ticketsHtml(tickets: EmailTicket[], base: string): string {
  return tickets
    .map(
      (t) =>
        `<img src="${base}/t/${t.number}.${ticketExt}" width="520" alt="Ticket ${t.number}" />`
    )
    .join("\n");
}

function buildVars(s: EmailSettings, v: RenderVars, base: string): Record<string, string> {
  const first = v.tickets[0];
  return {
    name: v.name,
    email: v.email,
    count: String(v.tickets.length),
    raffle_name: v.raffleName,
    product: v.product || v.raffleName,
    confirmation_id: first ? first.code : "",
    ticket_numbers: v.tickets.map((t) => `#${t.number}`).join(", "),
    link_acceso: v.linkAcceso || `${base}/?email=${encodeURIComponent(v.email)}`,
    whatsapp_url: s.whatsapp_url,
    tickets_url: `${base}/?email=${encodeURIComponent(v.email)}`,
    tickets_html: ticketsHtml(v.tickets, base),
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
