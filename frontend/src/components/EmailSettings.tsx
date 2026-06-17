import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "./Toast";

type Settings = {
  from_email: string;
  from_name: string;
  subject: string;
  preheader: string;
  whatsapp_url: string;
  html: string;
};

const FIELDS: Array<{ key: keyof Settings; label: string; hint?: string }> = [
  { key: "from_email", label: "Correo remitente", hint: "Debe estar verificado en Brevo" },
  { key: "from_name", label: "Nombre del remitente" },
  { key: "subject", label: "Asunto", hint: "Variables: {{name}} {{count}}" },
  { key: "preheader", label: "Texto de vista previa (preview)", hint: "Variables: {{name}} {{count}}" },
  { key: "whatsapp_url", label: "URL del botón de WhatsApp" },
];

export default function EmailSettings() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    api.getEmailSettings().then(setS).catch((e) => toast(e.message, "err"));
  }, [toast]);

  if (!s) return <div>Cargando ajustes del email…</div>;

  const set = (k: keyof Settings, v: string) => setS({ ...s, [k]: v });

  async function save() {
    setSaving(true);
    try {
      await api.saveEmailSettings(s as any);
      toast("Email guardado", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    const to = prompt("¿A qué correo mando la prueba?");
    if (!to) return;
    try {
      await api.emailTest({ ...(s as any), to });
      toast(`Prueba enviada a ${to}`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? "Ocultar preview" : "Previsualizar"}
        </button>
        <button className="btn ghost sm" onClick={sendTest}>Enviar prueba</button>
        <button className="btn sm" disabled={saving} onClick={save}>{saving ? "Guardando…" : "Guardar"}</button>
      </div>

      <div className="row">
        {FIELDS.map((f) => (
          <div key={f.key} style={{ flex: "1 1 240px" }} className="field">
            <label className="label">{f.label}</label>
            <input className="input" value={s[f.key]} onChange={(e) => set(f.key, e.target.value)} />
            {f.hint && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{f.hint}</p>}
          </div>
        ))}
      </div>

      <div className="field">
        <label className="label">HTML del email</label>
        <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Variables: <code>{"{{name}} {{count}} {{product}} {{link_acceso}} {{whatsapp_url}} {{tickets_url}} {{tickets_html}} {{confirmation_id}} {{ticket_numbers}} {{preheader}}"}</code>
        </p>
        <textarea
          className="input"
          style={{ minHeight: 280, fontFamily: "monospace", fontSize: 12 }}
          value={s.html}
          onChange={(e) => set("html", e.target.value)}
        />
      </div>

      {showPreview && (
        <div className="field">
          <label className="label">Vista previa (con datos de ejemplo no sustituidos)</label>
          <iframe
            title="preview"
            style={{ width: "100%", height: 600, border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff" }}
            srcDoc={s.html}
          />
        </div>
      )}
    </div>
  );
}
