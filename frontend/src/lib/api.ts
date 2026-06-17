// Cliente de la API. Mismo origen que el frontend (servido por la API).
const TOKEN_KEY = "admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req(path: string, opts: RequestInit = {}, auth = false) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (auth) {
    const t = getToken();
    if (t) headers.authorization = `Bearer ${t}`;
  }
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  // público
  searchTickets: (email: string) =>
    req(`/api/tickets?email=${encodeURIComponent(email)}`),

  // admin
  login: (password: string) =>
    req("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }),
  webhookInfo: () => req("/api/admin/webhook-info", {}, true),
  stats: () => req("/api/admin/stats", {}, true),
  listTickets: (q = "", limit = 100, offset = 0) =>
    req(`/api/admin/tickets?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, {}, true),
  createTickets: (body: { email: string; name?: string; quantity: number; send?: boolean }) =>
    req("/api/admin/tickets", { method: "POST", body: JSON.stringify(body) }, true),
  resend: (purchaseId: string) =>
    req("/api/admin/resend", { method: "POST", body: JSON.stringify({ purchaseId }) }, true),
  resendFailed: () => req("/api/admin/resend-failed", { method: "POST" }, true),
  reset: (raffle: string) =>
    req("/api/admin/reset", { method: "POST", body: JSON.stringify({ raffle, confirm: "RESET" }) }, true),

  // email settings
  getEmailSettings: () => req("/api/admin/email-settings", {}, true),
  saveEmailSettings: (body: Record<string, string>) =>
    req("/api/admin/email-settings", { method: "POST", body: JSON.stringify(body) }, true),
  emailTest: (body: Record<string, string>) =>
    req("/api/admin/email-test", { method: "POST", body: JSON.stringify(body) }, true),
};
