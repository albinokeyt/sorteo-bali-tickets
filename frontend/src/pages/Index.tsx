import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";

type Ticket = {
  ticket_number: string;
  number: number;
  name: string;
  status: string;
  raffle_name: string;
  image_url: string;
};

export default function Index() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [link, setLink] = useState<string | null>(null);

  // Permite abrir directamente con ?email=... (lo usa el botón del email)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("email");
    if (q) {
      setEmail(q);
      search(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e?: string) {
    const value = (e ?? email).trim();
    if (!value.includes("@")) return toast("Pon un email válido", "err");
    setLoading(true);
    try {
      const res = await api.searchTickets(value);
      if (res.count === 0) {
        setTickets([]);
        toast("No hay tickets con ese correo", "err");
      } else {
        setTickets(res.tickets);
        setLink(res.link_acceso ?? null);
        toast(`${res.count} ticket(s) encontrados`, "ok");
      }
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap center">
      <div className="badge">🎟️ VIAJE A BALI · JORGE DAREK</div>
      <h1 className="title-dark">Consulta tus tickets</h1>

      {!tickets ? (
        <div className="card" style={{ maxWidth: 460 }}>
          <p className="muted">Ingresa el correo con el que compraste para ver tus números.</p>
          <div className="field">
            <input
              className="input"
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
          </div>
          <button className="btn gold" disabled={loading} onClick={() => search()}>
            {loading ? "Buscando..." : "Buscar mis tickets"}
          </button>
        </div>
      ) : (
        <div style={{ width: "100%" }}>
          <button className="btn ghost sm" onClick={() => setTickets(null)}>
            ← Buscar otro correo
          </button>
          <div className="card" style={{ marginTop: 16 }}>
            <h2>Tienes {tickets.length} ticket(s)</h2>
            <p className="muted">Correo: {email}</p>
            {link && (
              <a className="btn gold" href={link} target="_blank" rel="noopener noreferrer"
                 style={{ marginTop: 4, marginBottom: 4 }}>
                🔑 Accede a tus productos
              </a>
            )}
            <div className="grid" style={{ marginTop: 16 }}>
              {tickets.map((t) => (
                <div className="ticket" key={t.ticket_number}>
                  <img src={t.image_url} alt={`Ticket ${t.number}`} loading="lazy" />
                  <div className="num">#{t.number}</div>
                  <div className="muted">{t.ticket_number} · {t.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
