import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";

type Ticket = { number: number; code: string; annulled: boolean };
type Purchase = {
  id: string;
  external_order_id: string;
  email: string;
  name: string;
  quantity: number;
  email_status: string;
  created_at: string;
  tickets: Ticket[];
};

export default function Purchases() {
  const toast = useToast();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0); // base 0
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const r = await api.listPurchases(q, pageSize, page * pageSize);
      setPurchases(r.purchases);
      setTotal(r.total ?? r.purchases.length);
    } catch (e: any) {
      toast(e.message, "err");
    }
  }, [q, pageSize, page, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Al cambiar búsqueda o tamaño de página, vuelve a la primera página
  useEffect(() => {
    setPage(0);
  }, [q, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function resend(p: Purchase) {
    try {
      await api.resend(p.id);
      toast(`Email reencolado a ${p.email}`, "ok");
      refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function editEmail(p: Purchase) {
    const email = prompt(`Nuevo email para la compra ${p.external_order_id}:`, p.email);
    if (!email || email === p.email) return;
    const resend = confirm("¿Reenviar el email a la nueva dirección ahora?");
    try {
      await api.setPurchaseEmail(p.id, email, resend);
      toast("Email actualizado" + (resend ? " y reenviado" : ""), "ok");
      refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function toggleAnnul(t: Ticket) {
    try {
      await api.annulTicket(t.code, !t.annulled);
      toast(t.annulled ? `Ticket ${t.code} reactivado` : `Ticket ${t.code} anulado`, "ok");
      refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  async function download(excludeAnnulled = false) {
    try {
      await api.exportCsv(excludeAnnulled);
      toast("Descargando CSV…", "ok");
    } catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Compras y tickets</h2>
        <div className="row">
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="Buscar email, nombre u order id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input" style={{ width: "auto" }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button className="btn sm" onClick={() => download(false)}>⬇ Descargar todos</button>
          <button className="btn ghost sm" onClick={() => download(true)}>⬇ Sin anulados</button>
        </div>
      </div>

      <div className="grid" style={{ gap: 10 }}>
        {purchases.map((p) => {
          const isOpen = open[p.id];
          return (
            <div key={p.id} style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: "1 1 280px" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>
                    Order: {p.external_order_id}
                  </div>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{p.email}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={`pill ${p.email_status}`}>{p.email_status}</span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {p.tickets.length} ticket(s)
                  </div>
                </div>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn ghost sm" onClick={() => setOpen({ ...open, [p.id]: !isOpen })}>
                  {isOpen ? "Ocultar tickets" : "Ver tickets"}
                </button>
                <button className="btn ghost sm" onClick={() => editEmail(p)}>✏️ Editar email</button>
                <button className="btn ghost sm" onClick={() => resend(p)}>↻ Reenviar</button>
              </div>

              {isOpen && (
                <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 10 }}>
                  {p.tickets.map((t) => (
                    <div key={t.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                      <span style={{ textDecoration: t.annulled ? "line-through" : "none", opacity: t.annulled ? 0.5 : 1 }}>
                        <strong>#{t.number}</strong> <span style={{ fontFamily: "monospace", fontSize: 12 }}>{t.code}</span>
                        {t.annulled && <span className="pill failed" style={{ marginLeft: 8 }}>anulado</span>}
                      </span>
                      <button className={`btn sm ${t.annulled ? "ghost" : "danger"}`} onClick={() => toggleAnnul(t)}>
                        {t.annulled ? "Reactivar" : "Anular"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {purchases.length === 0 && (
          <p className="muted" style={{ textAlign: "center", padding: 20 }}>Sin compras todavía</p>
        )}
      </div>

      {/* Paginación */}
      {total > 0 && (
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {total} compra(s) · página {page + 1} de {totalPages}
          </span>
          <div className="row">
            <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Anterior</button>
            <button className="btn ghost sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button>
          </div>
        </div>
      )}
    </div>
  );
}
