import { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";

type NotSent = {
  id: string;
  external_order_id: string;
  name: string;
  email: string;
  quantity: number;
  email_status: string;
  created_at: string;
};
type Status = {
  purchases: { total: number; sent: number; pending: number; failed: number };
  queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  dryRun: boolean;
  notSent: NotSent[];
};

export default function QueueStatus() {
  const toast = useToast();
  const [s, setS] = useState<Status | null>(null);
  const [auto, setAuto] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api.queueStatus());
    } catch (e: any) {
      toast(e.message, "err");
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresco cada 2s mientras esté activado (para ver la cola vaciarse)
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [auto, load]);

  if (!s) return null;

  const { total, sent, pending, failed } = s.purchases;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>
          📊 Estado de envíos {s.dryRun && <span className="pill pending">SIMULACIÓN</span>}
        </h2>
        <div className="row">
          <button className="btn ghost sm" onClick={load}>↻ Actualizar</button>
          <button className={`btn sm ${auto ? "" : "ghost"}`} onClick={() => setAuto((v) => !v)}>
            {auto ? "⏸ Auto" : "▶ Auto"}
          </button>
        </div>
      </div>

      {/* Barra de progreso: enviados / total */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="muted">{sent} de {total} emails enviados</span>
        <strong>{pct}%</strong>
      </div>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>

      {/* Contadores */}
      <div className="row" style={{ marginTop: 14, gap: 18 }}>
        <span><span className="dot" style={{ background: "#16a34a" }} />Enviados: <strong>{sent}</strong></span>
        <span><span className="dot" style={{ background: "#eab308" }} />Pendientes: <strong>{pending}</strong></span>
        <span><span className="dot" style={{ background: "#dc2626" }} />Fallidos: <strong>{failed}</strong></span>
        <span className="muted">En cola ahora: {s.queue.waiting + s.queue.active} (activos {s.queue.active})</span>
      </div>

      {/* Desplegable: compras sin enviar */}
      {s.notSent.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
            {open ? "▼" : "▶"} Ver {s.notSent.length} compra(s) sin enviar
          </button>
          {open && (
            <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 10 }}>
              <table>
                <thead>
                  <tr><th>Order ID</th><th>Nombre</th><th>Email</th><th>Tks</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {s.notSent.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.external_order_id}</td>
                      <td>{p.name}</td>
                      <td>{p.email}</td>
                      <td>{p.quantity}</td>
                      <td><span className={`pill ${p.email_status}`}>{p.email_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
