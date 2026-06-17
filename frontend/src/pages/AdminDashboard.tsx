import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, getToken } from "../lib/api";
import { useToast } from "../components/Toast";
import EmailSettings from "../components/EmailSettings";

type Stats = { tickets: string; purchases: string; sent: string; pending: string; failed: string };
type Row = {
  ticket_number: string;
  ticket_sequential_number: number;
  email: string;
  name: string;
  email_status: string;
  purchase_id: string;
};

export default function AdminDashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  // form crear
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) nav("/admin/login");
  }, [nav]);

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.stats(), api.listTickets(q)]);
      setStats(s);
      setRows(t.tickets);
    } catch (err: any) {
      if (String(err.message).includes("autoriz")) {
        clearToken();
        nav("/admin/login");
      } else toast(err.message, "err");
    }
  }, [q, nav, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create() {
    if (!email.includes("@")) return toast("Email inválido", "err");
    setBusy(true);
    try {
      const res = await api.createTickets({ email, name, quantity: Number(quantity), send: true });
      toast(`Creados ${res.ticketNumbers.length} ticket(s) y encolado el email`, "ok");
      setEmail("");
      setName("");
      setQuantity(1);
      refresh();
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function resend(id: string) {
    try {
      await api.resend(id);
      toast("Email reencolado", "ok");
      refresh();
    } catch (err: any) {
      toast(err.message, "err");
    }
  }

  async function resendFailed() {
    try {
      const r = await api.resendFailed();
      toast(`Reencolados ${r.requeued} emails`, "ok");
      refresh();
    } catch (err: any) {
      toast(err.message, "err");
    }
  }

  async function reset() {
    const slug = prompt('Esto BORRARÁ todos los tickets del sorteo. Escribe el slug del sorteo a resetear:', 'viaje-bali');
    if (!slug) return;
    if (!confirm(`¿Seguro? Se borrarán TODOS los tickets y compras de "${slug}".`)) return;
    try {
      await api.reset(slug);
      toast(`Sorteo "${slug}" reseteado`, "ok");
      refresh();
    } catch (err: any) {
      toast(err.message, "err");
    }
  }

  function logout() {
    clearToken();
    nav("/admin/login");
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="badge">🔐 PANEL ADMIN</div>
        <button className="btn ghost sm" onClick={logout}>Salir</button>
      </div>

      {/* Stats */}
      <div className="card">
        <div className="stats">
          <div className="stat"><div className="n">{stats?.tickets ?? "—"}</div><div className="l">Tickets</div></div>
          <div className="stat"><div className="n">{stats?.purchases ?? "—"}</div><div className="l">Compras</div></div>
          <div className="stat"><div className="n" style={{ color: "var(--ok)" }}>{stats?.sent ?? "—"}</div><div className="l">Enviados</div></div>
          <div className="stat"><div className="n" style={{ color: "#854d0e" }}>{stats?.pending ?? "—"}</div><div className="l">Pendientes</div></div>
          <div className="stat"><div className="n" style={{ color: "var(--err)" }}>{stats?.failed ?? "—"}</div><div className="l">Fallidos</div></div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn ghost sm" onClick={refresh}>↻ Refrescar</button>
          <button className="btn ghost sm" onClick={resendFailed}>Reenviar fallidos/pendientes</button>
          <button className="btn danger sm" onClick={reset}>Resetear sorteo</button>
        </div>
      </div>

      {/* Crear tickets */}
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Crear tickets manualmente</h2>
        <p className="muted">Crea una compra y manda el email con los tickets.</p>
        <div className="row">
          <div style={{ flex: "1 1 220px" }}>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@correo.com" />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label className="label">Nombre</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
          </div>
          <div style={{ flex: "0 0 120px" }}>
            <label className="label">Cantidad</label>
            <input className="input" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 1)} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn" style={{ width: "auto", padding: "13px 22px" }} disabled={busy} onClick={create}>
            {busy ? "Creando..." : "Crear y enviar"}
          </button>
        </div>
      </div>

      {/* Ajustes del email */}
      <EmailSettings />

      {/* Tabla de tickets */}
      <div className="card" style={{ marginTop: 20 }}>
        <div className="topbar">
          <h2 style={{ margin: 0 }}>Tickets</h2>
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Buscar por email o nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>#</th><th>Código</th><th>Nombre</th><th>Email</th><th>Email</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticket_number}>
                  <td><strong>#{r.ticket_sequential_number}</strong></td>
                  <td style={{ fontFamily: "monospace" }}>{r.ticket_number}</td>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td><span className={`pill ${r.email_status}`}>{r.email_status}</span></td>
                  <td><button className="btn ghost sm" onClick={() => resend(r.purchase_id)}>Reenviar</button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>Sin tickets</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
