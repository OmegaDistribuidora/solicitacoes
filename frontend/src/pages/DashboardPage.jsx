import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

export default function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiJson("/dashboard", { token })
      .then(setData)
      .catch((requestError) => setError(requestError.message));
  }, [token]);

  return (
    <div className="page-stack">
      <section className="page-card compact-page-header">
        <div className="eyebrow">Administracao</div>
        <h1>Inicio</h1>
        <p className="muted">Resumo operacional do sistema.</p>
      </section>
      {error ? <p className="error-text">{error}</p> : null}
      <section className="stats-grid">
        {[
          ["Usuarios ativos", data?.users ?? "-"],
          ["RCAs na base", data?.rcas ?? "-"],
          ["Rotas cadastradas", data?.entries ?? "-"],
          ["Solicitacoes pendentes", data?.pendingRequests ?? "-"],
          ["Rotas de promotor", data?.promoterRoutes ?? "-"],
          ["Alteracoes aguardando sincronizacao", data?.pendingPromoterRequests ?? "-"],
          ["Books", data?.books ?? "-"]
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span className="metric-label">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
    </div>
  );
}
