import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiJson } from "../services/api";

const DAYS = ["Segunda-Feira", "Ter\u00e7a-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "S\u00e1bado"];
const EMPTY_FORM = {
  codpromotor: "",
  promotor: "",
  areaatuacao: "",
  codcli: "",
  cliente: "",
  frequencia: "",
  dia: "",
  status: "Ativo",
  obs: ""
};

function actionLabel(action) {
  if (action === "CREATE") return "Inclusao";
  if (action === "UPDATE") return "Alteracao";
  return "Exclusao";
}

function statusLabel(status) {
  if (status === "APPROVED") return "Aguardando aplicacao no Omega";
  if (status === "REJECTED") return "Recusada";
  if (status === "APPLIED") return "Aplicada";
  if (status === "FAILED") return "Falha na aplicacao";
  return "Pendente de aprovacao";
}

function RequestForm({ entry, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(
    entry
      ? Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, entry[key] ?? ""]))
      : EMPTY_FORM
  );

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave({
      action: entry ? "UPDATE" : "CREATE",
      sourceId: entry?.sourceId,
      data: { ...form, codcli: Number(form.codcli), dia: form.dia || null, frequencia: form.frequencia || null }
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Promotores / Rota</div>
            <h2>{entry ? "Editar rota" : "Nova rota"}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <div className="form-two">
            <label>Codigo do promotor<input value={form.codpromotor} onChange={(event) => update("codpromotor", event.target.value)} /></label>
            <label>Promotor<input value={form.promotor} onChange={(event) => update("promotor", event.target.value)} /></label>
          </div>
          <div className="form-two">
            <label>Codigo do cliente<input type="number" min="1" required value={form.codcli} onChange={(event) => update("codcli", event.target.value)} /></label>
            <label>Cliente<input value={form.cliente} onChange={(event) => update("cliente", event.target.value)} /></label>
          </div>
          <label>Area de atuacao<input value={form.areaatuacao} onChange={(event) => update("areaatuacao", event.target.value)} /></label>
          <div className="form-two">
            <label>Frequencia<input placeholder="Ex.: 1M, 2M, 4T" value={form.frequencia} onChange={(event) => update("frequencia", event.target.value)} /></label>
            <label>Dia<select value={form.dia} onChange={(event) => update("dia", event.target.value)}><option value="">Ainda nao definido</option>{DAYS.map((day) => <option key={day}>{day}</option>)}</select></label>
          </div>
          <label>Status<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="">Nao definido</option><option>Ativo</option><option>Inativo</option></select></label>
          <label>Observacao<textarea rows={3} value={form.obs} onChange={(event) => update("obs", event.target.value)} /></label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions">
            <button className="primary-btn" type="submit" disabled={saving}>{saving ? "Enviando..." : "Salvar alteracao"}</button>
            <button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </section>
    </div>
  );
}
export default function RotaPromotorPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState([]);
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  const [editing, setEditing] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  async function load(nextPage = page, nextQuery = appliedQuery) {
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "30", q: nextQuery });
      const [entryPayload, requestPayload] = await Promise.all([
        apiJson(`/modules/rota-promotor/entries?${params}`, { token }),
        apiJson("/modules/rota-promotor/requests?status=ALL", { token })
      ]);
      setEntries(entryPayload.entries || []);
      setPageInfo({ total: entryPayload.total || 0, totalPages: entryPayload.totalPages || 1 });
      setRequests(requestPayload.requests || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { load(); }, [token, page, appliedQuery]);

  async function saveRequest(payload) {
    setSaving(true);
    setFormError("");
    try {
      await apiJson("/modules/rota-promotor/requests", { method: "POST", token, data: payload });
      setEditing(undefined);
      await load();
    } catch (requestError) {
      setFormError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(entry) {
    if (!window.confirm(`Excluir a rota de ${entry.codcli} - ${entry.cliente || "cliente"}? A alteracao sera aprovada automaticamente.`)) return;
    try {
      await apiJson("/modules/rota-promotor/requests", {
        method: "POST", token, data: { action: "DELETE", sourceId: entry.sourceId }
      });
      await load();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const activeRequests = requests.filter((item) => ["PENDING", "APPROVED"].includes(item.status));
  const historyRequests = requests.filter((item) => !["PENDING", "APPROVED"].includes(item.status));

  function requestRows(items) {
    return items.map((item) => {
      const data = item.requestedData || item.currentData || {};
      return (
        <tr key={item.id}>
          <td>#{item.id}</td><td>{actionLabel(item.action)}</td>
          <td>{data.promotor || "-"}</td><td>{data.codcli || "-"} - {data.cliente || "-"}</td>
          <td>{data.frequencia || "-"} / {data.dia || "-"}</td>
          <td>{item.requesterUser?.displayName || "-"}</td>
          <td><strong>{statusLabel(item.status)}</strong>{item.applyError ? <div className="error-text small">{item.applyError}</div> : null}</td>
        </tr>
      );
    });
  }

  return (
    <div className="page-stack">
      <section className="page-card compact-page-header">
        <div className="section-header"><div><div className="eyebrow">Promotores</div><h2>Rotas</h2><p className="muted">Inclusoes, alteracoes e exclusoes sao aprovadas automaticamente e aplicadas no Omega pela sincronizacao.</p></div><button className="primary-btn" onClick={() => setEditing(null)}>Nova rota</button></div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
      <section className="table-card">
        <div className="toolbar"><div><h2>Rotas atuais</h2><p className="muted small">{pageInfo.total} linha(s) sincronizadas do Omega.</p></div><div className="inline-actions"><input placeholder="Promotor, cliente ou codigo" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(query); } }} /><button className="secondary-btn" onClick={() => { setPage(1); setAppliedQuery(query); }}>Buscar</button></div></div>
        <div className="table-wrap"><table><thead><tr><th>Promotor</th><th>Cliente</th><th>Area</th><th>Frequencia</th><th>Dia</th><th>Status</th><th>Acoes</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.sourceId}><td>{entry.codpromotor ? `${entry.codpromotor} - ` : ""}{entry.promotor || "-"}</td><td>{entry.codcli} - {entry.cliente || "-"}</td><td>{entry.areaatuacao || "-"}</td><td>{entry.frequencia || "-"}</td><td>{entry.dia || "-"}</td><td>{entry.status || "-"}</td><td><div className="inline-actions"><button className="secondary-btn compact-btn" onClick={() => setEditing(entry)}>Editar</button><button className="danger-btn compact-btn" onClick={() => requestDelete(entry)}>Excluir</button></div></td></tr>)}</tbody></table></div>
        {!entries.length ? <div className="empty-state">Nenhuma rota encontrada.</div> : null}
        <div className="pagination-bar"><button className="secondary-btn compact-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Pagina {page} de {pageInfo.totalPages}</span><button className="secondary-btn compact-btn" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>Proxima</button></div>
      </section>
      <section className="table-card"><h2>Alteracoes aguardando sincronizacao</h2>{activeRequests.length ? <div className="table-wrap"><table><thead><tr><th>ID</th><th>Acao</th><th>Promotor</th><th>Cliente</th><th>Rota</th><th>Solicitante</th><th>Status</th></tr></thead><tbody>{requestRows(activeRequests)}</tbody></table></div> : <div className="empty-state">Nenhuma alteracao aguardando sincronizacao.</div>}</section>
      <section className="table-card"><h2>Historico</h2>{historyRequests.length ? <div className="table-wrap"><table><thead><tr><th>ID</th><th>Acao</th><th>Promotor</th><th>Cliente</th><th>Rota</th><th>Solicitante</th><th>Status</th></tr></thead><tbody>{requestRows(historyRequests)}</tbody></table></div> : <div className="empty-state">Nenhuma alteracao concluida.</div>}</section>
      {editing !== undefined ? <RequestForm entry={editing} saving={saving} error={formError} onClose={() => { setEditing(undefined); setFormError(""); }} onSave={saveRequest} /> : null}
    </div>
  );
}
