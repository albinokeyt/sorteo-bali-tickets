import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";

type Info = {
  method: string;
  url: string;
  urlWithToken: string;
  header: { name: string; value: string };
  fields: Record<string, string>;
};

export default function WebhookInfo() {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    api.webhookInfo().then(setInfo).catch(() => {});
  }, []);

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast(`${what} copiado`, "ok"),
      () => toast("No se pudo copiar", "err")
    );
  }

  if (!info) return null;

  const box: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 13,
    background: "#0f172a",
    color: "#e2e8f0",
    padding: "10px 12px",
    borderRadius: 8,
    wordBreak: "break-all",
    flex: 1,
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>🔗 Webhook para GHL</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Pega esta URL en la acción <strong>Webhook</strong> de tu workflow de GHL (método POST).
      </p>

      <label className="label">URL lista para usar (token incluido)</label>
      <div className="row" style={{ alignItems: "stretch", marginBottom: 14 }}>
        <div style={box}>{info.urlWithToken}</div>
        <button className="btn sm" onClick={() => copy(info.urlWithToken, "Webhook")}>Copiar</button>
      </div>

      <details>
        <summary className="muted" style={{ cursor: "pointer", marginBottom: 8 }}>
          Alternativa con header (más seguro)
        </summary>
        <label className="label">URL</label>
        <div className="row" style={{ alignItems: "stretch", marginBottom: 10 }}>
          <div style={box}>{info.url}</div>
          <button className="btn ghost sm" onClick={() => copy(info.url, "URL")}>Copiar</button>
        </div>
        <label className="label">Header</label>
        <div className="row" style={{ alignItems: "stretch" }}>
          <div style={box}>{info.header.name}: {info.header.value}</div>
          <button className="btn ghost sm" onClick={() => copy(`${info.header.name}: ${info.header.value}`, "Header")}>Copiar</button>
        </div>
      </details>

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        Mapeo de campos activo: <code>{Object.entries(info.fields).map(([k, v]) => `${k}=${v}`).join(" · ")}</code>
      </p>
    </div>
  );
}
