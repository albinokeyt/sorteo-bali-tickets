import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken, getToken } from "../lib/api";
import { useToast } from "../components/Toast";
import EmailSettings from "../components/EmailSettings";
import WebhookInfo from "../components/WebhookInfo";
import Purchases from "../components/Purchases";
import Modal from "../components/Modal";

type Stats = { tickets: string; purchases: string; sent: string; pending: string; failed: string };

export default function AdminDashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);

  // modales
  const [showWebhook, setShowWebhook] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  // form crear
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) nav("/admin/login");
  }, [nav]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.stats());
    } catch (err: any) {
      if (String(err.message).includes("autoriz")) {
        clearToken();
        nav("/admin/login");
      } else toast(err.message, "err");
    }
  }, [nav, toast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  async function create() {
    if (!email.includes("@")) return toast("Email inválido", "err");
    setBusy(true);
    try {
      const res = await api.createTickets({ email, name, quantity: Number(quantity), send: true });
      toast(`Creados ${res.ticketNumbers.length} ticket(s) y encolado el email`, "ok");
      setEmail("");
      setName("");
      setQuantity(1);
      loadStats();
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function resendFailed() {
    try {
      const r = await api.resendFailed();
      toast(`Reencolados ${r.requeued} emails`, "ok");
      loadStats();
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
      loadStats();
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
        <div className="row">
          <button className="btn ghost sm" onClick={() => setShowWebhook(true)}>🔗 Webhook</button>
          <button className="btn ghost sm" onClick={() => setShowEmail(true)}>✉️ Email</button>
          <button className="btn ghost sm" onClick={logout}>Salir</button>
        </div>
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
          <button className="btn ghost sm" onClick={loadStats}>↻ Refrescar</button>
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

      {/* Compras y tickets (desglose) */}
      <Purchases />

      {/* Modales */}
      <Modal open={showWebhook} onClose={() => setShowWebhook(false)} title="🔗 Webhook para GHL">
        <WebhookInfo />
      </Modal>
      <Modal open={showEmail} onClose={() => setShowEmail(false)} title="✉️ Email que se envía" width={820}>
        <EmailSettings />
      </Modal>
    </div>
  );
}
