import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

export default function AuditPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiJson("/audit", { token })
      .then((payload) => setLogs(payload.logs || []))
      .catch((requestError) => setError(requestError.message));
  }, [token]);

  return (
    <div className="page-stack">
      <section className="page-card compact-page-header">
        <div className="eyebrow">Administracao</div>
        <h1>Auditoria</h1>
        <p className="muted">Ultimos eventos registrados no sistema.</p>
      </section>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Usuario</th>
                <th>Acao</th>
                <th>Resumo</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
                  <td>{log.actorDisplayName || log.actorUsername || "-"}</td>
                  <td>{log.action}</td>
                  <td>{log.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
