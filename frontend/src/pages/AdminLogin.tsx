import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";
import { useToast } from "../components/Toast";

export default function AdminLogin() {
  const toast = useToast();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    try {
      const res = await api.login(password);
      setToken(res.token);
      nav("/admin");
    } catch (err: any) {
      toast(err.message, "err");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap center">
      <div className="badge">🔐 PANEL ADMIN</div>
      <h1 className="title-dark">Acceso administrador</h1>
      <div className="card" style={{ maxWidth: 380 }}>
        <div className="field">
          <label className="label">Contraseña</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            autoFocus
          />
        </div>
        <button className="btn" disabled={loading} onClick={login}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}
