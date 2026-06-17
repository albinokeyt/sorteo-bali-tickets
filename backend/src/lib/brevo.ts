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

export async function sendEmail(input: SendEmailInput): Promise<string> {
  const sender = input.from ?? { email: config.brevo.fromEmail, name: config.brevo.fromName };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
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

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${body}`);
  }
  const data = (await res.json().catch(() => ({}))) as { messageId?: string };
  return data.messageId ?? "";
}
