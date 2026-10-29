// Cliente mínimo de la API transaccional de Brevo.
import { config } from "../config";

export type BrevoAttachment = {
  name: string;
  content: string; // base64
};

export type SendEmailInput = {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  from?: { email: string; name: string };
  attachments?: BrevoAttachment[];
  tags?: string[];
};

// Error de Brevo con su código HTTP (0 = red/timeout).
export class BrevoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  // 4xx salvo 429 = error del propio email/cuenta: reintentar no sirve.
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429 && this.status !== 408;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<string> {
  const sender = input.from ?? { email: config.brevo.fromEmail, name: config.brevo.fromName };
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      // Sin esto, una conexión colgada bloquearía el trabajo indefinidamente.
      signal: AbortSignal.timeout(config.brevo.timeoutMs),
      headers: {
        "api-key": config.brevo.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [input.to],
        subject: input.subject,
        htmlContent: input.html,
        attachment: input.attachments,
        tags: input.tags,
      }),
    });
  } catch (err: any) {
    const why = err?.name === "TimeoutError" ? `timeout ${config.brevo.timeoutMs} ms` : err?.message ?? String(err);
    throw new BrevoError(0, `Brevo sin respuesta: ${why}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BrevoError(res.status, `Brevo ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { messageId?: string };
  return data.messageId ?? "";
}
