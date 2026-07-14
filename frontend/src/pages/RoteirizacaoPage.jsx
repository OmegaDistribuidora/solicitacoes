import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiFormData, apiJson } from "../services/api";

const DAYS = ["Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];
const TYPES = ["Semanal", "Quinzena 1 (Ímpar)", "Quinzena 2 (Par)"];
const BASE_ODD_WEEK = new Date(2026, 6, 12);
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];

function dayIndex(day) {
  return DAYS.indexOf(day) + 1;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isOddWeek(date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const diffDays = Math.round((start - BASE_ODD_WEEK) / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);
  return Math.abs(diffWeeks % 2) === 0;
}

function shouldHighlight(date, selectedDay, selectedType) {
  if (!selectedDay || date.getDay() !== dayIndex(selectedDay)) return false;
  if (selectedType === "Semanal") return true;
  if (selectedType === "Quinzena 1 (Ímpar)") return isOddWeek(date);
  if (selectedType === "Quinzena 2 (Par)") return !isOddWeek(date);
  return false;
}

function requestKindLabel(kind) {
  return kind === "INCLUSAO" ? "Inclusão" : "Modificação";
}

function statusLabel(status) {
  if (status === "APPROVED") return "Aprovada";
  if (status === "REJECTED") return "Recusada";
  return "Pendente";
}

function CalendarPreview({ selectedDay, selectedType }) {
  const today = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const weeks = useMemo(() => {
    const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const firstSunday = new Date(firstDay);
    firstSunday.setDate(firstDay.getDate() - firstDay.getDay());

    return Array.from({ length: 6 }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = new Date(firstSunday);
        date.setDate(firstSunday.getDate() + weekIndex * 7 + day);
        return date;
      })
    );
  }, [visibleMonth]);

  function moveMonth(direction) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  }

  return (
    <div className="calendar-month">
      <div className="calendar-month-header">
        <strong>
          {MONTHS[visibleMonth.getMonth()]} de {visibleMonth.getFullYear()}
        </strong>
        <div className="calendar-nav">
          <button type="button" className="icon-btn" onClick={() => moveMonth(-1)} aria-label="Mês anterior">
            ‹
          </button>
          <button type="button" className="icon-btn" onClick={() => moveMonth(1)} aria-label="Próximo mês">
            ›
          </button>
        </div>
      </div>
      <div className="calendar-head">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      {weeks.map((week, index) => (
        <div className="calendar-row" key={index}>
          {week.map((date) => {
            const isOutsideMonth = date.getMonth() !== visibleMonth.getMonth();
            const isToday = isSameDay(date, today);
            const isHighlighted = shouldHighlight(date, selectedDay, selectedType);
            return (
              <span
                key={date.toISOString()}
                className={[
                  isOutsideMonth ? "is-outside-month" : "",
                  isToday ? "is-today" : "",
                  isHighlighted ? "is-highlighted" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={isOddWeek(date) ? "Semana ímpar" : "Semana par"}
              >
                {date.getDate()}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function CheckboxDropdown({ label, values, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const summary = values.length ? `${values.length} selecionado(s)` : "Todos";

  useEffect(() => {
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function toggleOption(option) {
    onChange(values.includes(option) ? values.filter((item) => item !== option) : [...values, option]);
  }

  return (
    <div className="dropdown-filter" ref={rootRef}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((current) => !current)}>
        <span>
          <small>{label}</small>
          <strong>{summary}</strong>
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dropdown-menu">
          <label className="dropdown-check">
            <input type="checkbox" checked={!values.length} onChange={() => onChange([])} />
            <span>Todos</span>
          </label>
          {options.map((option) => (
            <label className="dropdown-check" key={option}>
              <input type="checkbox" checked={values.includes(option)} onChange={() => toggleOption(option)} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionDialog({ title, children, confirmLabel, danger, saving, onCancel, onConfirm, wide }) {
  return (
    <div className="modal-backdrop modal-backdrop-nested" role="presentation" onClick={onCancel}>
      <section
        className={`modal-card ${wide ? "modal-card-wide" : "modal-card-sm"}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">Confirmação</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel}>
            x
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="modal-actions">
          <button type="button" className={danger ? "danger-btn" : "primary-btn"} onClick={onConfirm} disabled={saving}>
            {saving ? "Processando..." : confirmLabel}
          </button>
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        </div>
      </section>
    </div>
  );
}

function FlowPickerModal({ onClose, onPick }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card modal-card-sm" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Roteirização</div>
            <h2>Nova solicitação</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            x
          </button>
        </div>
        <div className="flow-choice-grid">
          <button type="button" className="flow-choice" onClick={() => onPick("INCLUSAO")}>
            <strong>Inclusão de rota</strong>
            <span>Adicionar novos clientes à rota de um vendedor.</span>
          </button>
          <button type="button" className="flow-choice" onClick={() => onPick("MODIFICACAO")}>
            <strong>Modificação de rota</strong>
            <span>Alterar dia ou tipo de clientes já roteirizados.</span>
          </button>
          <button type="button" className="flow-choice" onClick={() => onPick("IMPORT")}>
            <strong>Importar planilha</strong>
            <span>Enviar vários ajustes e conferir a prévia antes de criar.</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function RequestModal({ initialMode, token, rcas, onClose, onCreated }) {
  const [mode, setMode] = useState(initialMode);
  const [codusur, setCodusur] = useState("");
  const [clients, setClients] = useState([]);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ codcli: "", requestedDia: DAYS[0], requestedTipo: TYPES[0] });
  const [manualConfirm, setManualConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedVendor = rcas.find((rca) => String(rca.codusur) === String(codusur));

  useEffect(() => {
    setItems([]);
    setClients([]);
    setManualConfirm(null);
    setForm({ codcli: "", requestedDia: DAYS[0], requestedTipo: TYPES[0] });
  }, [mode, codusur]);

  useEffect(() => {
    if (mode !== "MODIFICACAO" || !codusur) return;
    apiJson(`/modules/roteirizacao/vendors/${codusur}/clients`, { token })
      .then((payload) => setClients(payload.clients || []))
      .catch((requestError) => setError(requestError.message));
  }, [mode, codusur, token]);

  function buildCurrentItem({ requireClient }) {
    const codcli = Number(form.codcli);
    if (!selectedVendor) {
      throw new Error("Selecione um vendedor.");
    }
    if (!Number.isInteger(codcli) || codcli <= 0) {
      if (requireClient) throw new Error("Informe ou selecione um cliente.");
      return null;
    }
    const currentClient = clients.find((client) => Number(client.codcli) === codcli);
    return {
      action: mode === "INCLUSAO" ? "ADD" : "UPDATE",
      codusur: selectedVendor.codusur,
      codcli,
      cliente: currentClient?.cliente || "",
      requestedDia: form.requestedDia,
      requestedTipo: form.requestedTipo,
      currentDia: currentClient?.dia,
      currentTipo: currentClient?.tipo
    };
  }

  function addItem() {
    setError("");
    try {
      const item = buildCurrentItem({ requireClient: true });
      setItems((current) => [...current, item]);
      setForm((current) => ({ ...current, codcli: "" }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function collectItemsForSubmit() {
    const finalItems = [...items];
    const currentItem = buildCurrentItem({ requireClient: finalItems.length === 0 });
    if (currentItem) {
      const alreadyAdded = finalItems.some(
        (item) => item.codusur === currentItem.codusur && item.codcli === currentItem.codcli
      );
      if (!alreadyAdded) finalItems.push(currentItem);
    }
    if (!finalItems.length) throw new Error("Informe ao menos um cliente para criar a solicitação.");
    return finalItems;
  }

  function submitManual(event) {
    event.preventDefault();
    setError("");
    try {
      setManualConfirm(collectItemsForSubmit());
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createManualRequest() {
    if (!manualConfirm?.length) return;
    setSaving(true);
    setError("");
    try {
      await apiJson("/modules/roteirizacao/requests", {
        method: "POST",
        token,
        data: { kind: mode, items: manualConfirm }
      });
      await onCreated();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
      setManualConfirm(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card route-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Roteirização</div>
            <h2>{requestKindLabel(mode)} de rota</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            x
          </button>
        </div>

        <div className="segmented">
          <button type="button" className={mode === "INCLUSAO" ? "is-active" : ""} onClick={() => setMode("INCLUSAO")}>
            Inclusão de rota
          </button>
          <button type="button" className={mode === "MODIFICACAO" ? "is-active" : ""} onClick={() => setMode("MODIFICACAO")}>
            Modificação de rota
          </button>
        </div>

        <div className="route-form-grid">
          <form className="form-stack" onSubmit={submitManual} noValidate>
            <label>
              Vendedor
              <select value={codusur} onChange={(event) => setCodusur(event.target.value)}>
                <option value="">Selecione</option>
                {rcas.map((rca) => (
                  <option key={rca.codusur} value={rca.codusur}>
                    {rca.codusur} - {rca.rca}
                  </option>
                ))}
              </select>
            </label>

            {mode === "MODIFICACAO" ? (
              <label>
                Cliente roteirizado
                <select value={form.codcli} onChange={(event) => setForm((current) => ({ ...current, codcli: event.target.value }))}>
                  <option value="">Selecione</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.codcli}>
                      {client.codcli} - {client.cliente} ({client.dia} / {client.tipo})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Código do cliente
                <input value={form.codcli} onChange={(event) => setForm((current) => ({ ...current, codcli: event.target.value }))} />
              </label>
            )}

            <div className="form-two">
              <label>
                Dia da semana
                <select value={form.requestedDia} onChange={(event) => setForm((current) => ({ ...current, requestedDia: event.target.value }))}>
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tipo
                <select value={form.requestedTipo} onChange={(event) => setForm((current) => ({ ...current, requestedTipo: event.target.value }))}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button type="button" className="secondary-btn" onClick={addItem}>
              Adicionar novo cliente
            </button>

            {items.length ? (
              <div className="stack-list">
                {items.map((item, index) => (
                  <div className="mini-row" key={`${item.codusur}-${item.codcli}-${index}`}>
                    <span>
                      {item.codusur} / {item.codcli}
                    </span>
                    <strong>
                      {item.requestedDia} - {item.requestedTipo}
                    </strong>
                  </div>
                ))}
              </div>
            ) : null}

            {error ? <p className="error-text">{error}</p> : null}
            <div className="modal-actions">
              <button type="submit" className="primary-btn" disabled={saving}>
                {saving ? "Enviando..." : "Criar solicitação"}
              </button>
            </div>
          </form>

          <aside className="preview-panel">
            <CalendarPreview selectedDay={form.requestedDia} selectedType={form.requestedTipo} />
          </aside>
        </div>

        {manualConfirm ? (
          <ActionDialog
            title="Criar solicitação?"
            confirmLabel="Criar solicitação"
            saving={saving}
            onCancel={() => setManualConfirm(null)}
            onConfirm={createManualRequest}
          >
            <div className="confirm-list">
              {manualConfirm.map((item, index) => (
                <div className="mini-row" key={`${item.codusur}-${item.codcli}-${index}`}>
                  <span>
                    {item.codusur} / {item.codcli}
                  </span>
                  <strong>
                    {item.currentDia ? `${item.currentDia} / ${item.currentTipo} para ` : ""}
                    {item.requestedDia} / {item.requestedTipo}
                  </strong>
                </div>
              ))}
            </div>
          </ActionDialog>
        ) : null}
      </section>
    </div>
  );
}

function ImportPreviewDialog({ preview, saving, onCancel, onConfirm }) {
  return (
    <ActionDialog title="Pré-visualização da importação" confirmLabel="Criar solicitações" saving={saving} onCancel={onCancel} onConfirm={onConfirm} wide>
      <div className="section-header">
        <p className="muted">
          {preview.summary.additions} inclusões, {preview.summary.updates} modificações, {preview.summary.total} linha(s).
        </p>
      </div>
      <div className="table-wrap preview-dialog-table">
        <table>
          <thead>
            <tr>
              <th>Ação</th>
              <th>Vendedor</th>
              <th>Cliente</th>
              <th>De</th>
              <th>Para</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 200).map((row, index) => (
              <tr className={row.action === "ADD" ? "preview-row-add" : "preview-row-update"} key={`${row.codusur}-${row.codcli}-${index}`}>
                <td>{row.action === "ADD" ? "Inclusão" : "Modificação"}</td>
                <td>
                  {row.codusur} - {row.rca}
                </td>
                <td>
                  {row.codcli} - {row.cliente}
                </td>
                <td>{row.currentDia ? `${row.currentDia} / ${row.currentTipo}` : "-"}</td>
                <td>
                  {row.dia} / {row.tipo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ActionDialog>
  );
}

function ImportModal({ token, onClose, onCreated }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleImport() {
    if (!file) {
      setError("Selecione uma planilha.");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    setError("");
    setSaving(true);
    try {
      const payload = await apiFormData("/modules/roteirizacao/import-preview", { token, data });
      setPreview(payload);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function createFromPreview() {
    if (!preview?.rows?.length) return;
    setSaving(true);
    setError("");
    try {
      const additions = preview.rows.filter((row) => row.action === "ADD");
      const updates = preview.rows.filter((row) => row.action === "UPDATE");
      if (additions.length) {
        await apiJson("/modules/roteirizacao/requests", {
          method: "POST",
          token,
          data: {
            kind: "INCLUSAO",
            items: additions.map((row) => ({
              action: "ADD",
              codusur: row.codusur,
              codcli: row.codcli,
              cliente: row.cliente,
              requestedDia: row.dia,
              requestedTipo: row.tipo
            }))
          }
        });
      }
      if (updates.length) {
        await apiJson("/modules/roteirizacao/requests", {
          method: "POST",
          token,
          data: {
            kind: "MODIFICACAO",
            items: updates.map((row) => ({
              action: "UPDATE",
              codusur: row.codusur,
              codcli: row.codcli,
              cliente: row.cliente,
              requestedDia: row.dia,
              requestedTipo: row.tipo
            }))
          }
        });
      }
      await onCreated();
      onClose();
    } catch (requestError) {
      setError(requestError.message);
      setPreview(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card modal-card-sm" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Roteirização</div>
            <h2>Importar planilha</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            x
          </button>
        </div>
        <div className="form-stack">
          <div className="import-box import-box-clean">
            <strong>Planilha de ajustes</strong>
            <p className="muted small">O sistema valida os vendedores pela base RCA e recusa a importação se houver vendedor fora da sua base.</p>
            <label className="file-drop">
              <input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <span>Escolher arquivo</span>
              <strong>{file?.name || "Nenhum arquivo selecionado"}</strong>
            </label>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="primary-btn" onClick={handleImport} disabled={saving}>
              {saving ? "Importando..." : "Importar"}
            </button>
            <button type="button" className="secondary-btn" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </div>
        {preview ? <ImportPreviewDialog preview={preview} saving={saving} onCancel={() => setPreview(null)} onConfirm={createFromPreview} /> : null}
      </section>
    </div>
  );
}

function ReviewDialog({ request, decision, saving, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const isReject = decision === "REJECTED";

  return (
    <ActionDialog
      title={isReject ? "Recusar solicitação?" : "Aprovar solicitação?"}
      confirmLabel={isReject ? "Recusar" : "Aprovar"}
      danger={isReject}
      saving={saving}
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason)}
    >
      <div className="form-stack">
        <p className="muted">Solicitação #{request.id}</p>
        <div className="confirm-list">
          {request.items?.map((item) => (
            <div className="mini-row" key={item.id}>
              <span>
                {item.codusur} - {item.rca} / {item.codcli}
              </span>
              <strong>
                {item.currentDia ? `${item.currentDia} / ${item.currentTipo} para ` : ""}
                {item.requestedDia} / {item.requestedTipo}
              </strong>
            </div>
          ))}
        </div>
        {isReject ? (
          <label>
            Motivo da recusa
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} autoFocus />
          </label>
        ) : null}
      </div>
    </ActionDialog>
  );
}

export default function RoteirizacaoPage() {
  const { token, user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesMeta, setEntriesMeta] = useState({ page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [activeRequests, setActiveRequests] = useState([]);
  const [historyRequests, setHistoryRequests] = useState([]);
  const [rcas, setRcas] = useState([]);
  const [filters, setFilters] = useState({ q: "", days: [], types: [] });
  const [flow, setFlow] = useState(null);
  const [reviewDialog, setReviewDialog] = useState(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshingEntries, setRefreshingEntries] = useState(false);
  const [error, setError] = useState("");
  const canReview = user?.role === "ADMIN" || user?.role === "ANALYST";

  async function loadAll(pageOverride = entriesPage) {
    const hasLoadedData = entries.length || activeRequests.length || historyRequests.length || rcas.length || entriesMeta.total;
    if (hasLoadedData) {
      setRefreshingEntries(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.days.length) params.set("days", filters.days.join(","));
      if (filters.types.length) params.set("types", filters.types.join(","));
      params.set("page", String(pageOverride));
      params.set("pageSize", "30");
      const [entriesPayload, activePayload, historyPayload, rcasPayload] = await Promise.all([
        apiJson(`/modules/roteirizacao/entries?${params.toString()}`, { token }),
        apiJson("/modules/roteirizacao/requests", { token }),
        apiJson("/modules/roteirizacao/requests?status=ALL", { token }),
        apiJson("/modules/roteirizacao/rcas", { token })
      ]);
      setEntries(entriesPayload.entries || []);
      setEntriesMeta({
        page: entriesPayload.page || pageOverride,
        pageSize: entriesPayload.pageSize || 30,
        total: entriesPayload.total || 0,
        totalPages: entriesPayload.totalPages || 1
      });
      setActiveRequests(activePayload.requests || []);
      setHistoryRequests((historyPayload.requests || []).filter((request) => request.status !== "PENDING"));
      setRcas(rcasPayload.rcas || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
      setRefreshingEntries(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [token, entriesPage, filters.days.join(","), filters.types.join(",")]);

  function updatePagedFilters(updater) {
    setEntriesPage(1);
    setFilters(updater);
  }

  function applySearch() {
    setEntriesPage(1);
    loadAll(1);
  }

  function moveEntriesPage(nextPage) {
    setEntriesPage(Math.min(Math.max(1, nextPage), entriesMeta.totalPages || 1));
  }

  async function confirmReview(reason) {
    if (!reviewDialog) return;
    setReviewSaving(true);
    try {
      await apiJson(`/modules/roteirizacao/requests/${reviewDialog.request.id}/review`, {
        method: "PATCH",
        token,
        data: { decision: reviewDialog.decision, reason }
      });
      setReviewDialog(null);
      await loadAll();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReviewSaving(false);
    }
  }

  function renderRequestRows(requests, options) {
    return requests.map((request) => (
      <tr key={request.id}>
        <td>#{request.id}</td>
        <td>{requestKindLabel(request.kind)}</td>
        <td>{request.requesterUser?.displayName || "-"}</td>
        <td>
          {request.items?.map((item) => (
            <div key={item.id} className="muted small">
              {item.codusur} - {item.rca} / {item.codcli}: {item.currentDia ? `${item.currentDia} -> ` : ""}
              {item.requestedDia} / {item.requestedTipo}
            </div>
          ))}
        </td>
        <td>{new Date(request.createdAt).toLocaleString("pt-BR")}</td>
        {options.history ? (
          <td>
            <div className="status-with-reason">
              <strong>{statusLabel(request.status)}</strong>
              {request.status === "REJECTED" && request.reviewReason ? <span>Motivo: {request.reviewReason}</span> : null}
            </div>
          </td>
        ) : null}
        {options.actions ? (
          <td>
            <div className="inline-actions">
              <button type="button" className="secondary-btn compact-btn" onClick={() => setReviewDialog({ request, decision: "APPROVED" })}>
                Aprovar
              </button>
              <button type="button" className="danger-btn compact-btn" onClick={() => setReviewDialog({ request, decision: "REJECTED" })}>
                Recusar
              </button>
            </div>
          </td>
        ) : null}
      </tr>
    ));
  }

  return (
    <div className="page-stack">
      <section className="page-card compact-page-header">
        <div className="section-header">
          <div>
            <div className="eyebrow">Módulo</div>
            <h1>Roteirização</h1>
            <p className="muted">Consulta de rotas, solicitações de inclusão e alteração.</p>
          </div>
          <button type="button" className="primary-btn" onClick={() => setFlow("CHOICE")}>
            Nova solicitação
          </button>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="table-card">
        <div className="section-header">
          <div>
            <h2>Solicitações ativas</h2>
            <p className="muted small">{activeRequests.length} pendente(s)</p>
          </div>
        </div>
        {activeRequests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipo</th>
                  <th>Solicitante</th>
                  <th>Ajustes</th>
                  <th>Criada em</th>
                  {canReview ? <th>Ações</th> : null}
                </tr>
              </thead>
              <tbody>{renderRequestRows(activeRequests, { actions: canReview, history: false })}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Nenhuma solicitação pendente.</div>
        )}
      </section>

      <section className="table-card">
        <div className="section-header">
          <div>
            <h2>Histórico de solicitações</h2>
            <p className="muted small">{historyRequests.length} solicitação(ões) concluída(s)</p>
          </div>
        </div>
        {historyRequests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipo</th>
                  <th>Solicitante</th>
                  <th>Ajustes</th>
                  <th>Criada em</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>{renderRequestRows(historyRequests, { actions: false, history: true })}</tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Nenhuma solicitação concluída ainda.</div>
        )}
      </section>

      <section className="table-card">
        <div className="filters-grid">
          <label>
            Buscar
            <input
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
              placeholder="RCA, cliente ou código"
            />
          </label>
          <CheckboxDropdown label="Dia da semana" values={filters.days} options={DAYS} onChange={(days) => updatePagedFilters((current) => ({ ...current, days }))} />
          <CheckboxDropdown label="Tipo" values={filters.types} options={TYPES} onChange={(types) => updatePagedFilters((current) => ({ ...current, types }))} />
          <button type="button" className="secondary-btn filter-btn" onClick={applySearch}>
            Filtrar
          </button>
        </div>
        {loading ? (
          <div>Carregando roteirização...</div>
        ) : (
          <div className={`table-wrap ${refreshingEntries ? "is-refreshing" : ""}`}>
            {refreshingEntries ? <div className="table-refresh-indicator">Atualizando filtros...</div> : null}
            <table>
              <thead>
                <tr>
                  <th>Supervisor</th>
                  <th>RCA</th>
                  <th>Cliente</th>
                  <th>Dia</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.codsup} - {entry.supervisor}
                    </td>
                    <td>
                      {entry.codusur} - {entry.rca}
                    </td>
                    <td>
                      {entry.codcli} - {entry.cliente}
                    </td>
                    <td>{entry.dia}</td>
                    <td>{entry.tipo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!entries.length ? <div className="empty-state">Nenhuma rota encontrada.</div> : null}
            <div className="pagination-bar">
              <span>
                Mostrando {entries.length ? (entriesMeta.page - 1) * entriesMeta.pageSize + 1 : 0}-
                {Math.min(entriesMeta.page * entriesMeta.pageSize, entriesMeta.total)} de {entriesMeta.total}
              </span>
              <div className="inline-actions">
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  disabled={entriesMeta.page <= 1}
                  onClick={() => moveEntriesPage(entriesMeta.page - 1)}
                >
                  Anterior
                </button>
                <span className="pagination-page">
                  Página {entriesMeta.page} de {entriesMeta.totalPages}
                </span>
                <button
                  type="button"
                  className="secondary-btn compact-btn"
                  disabled={entriesMeta.page >= entriesMeta.totalPages}
                  onClick={() => moveEntriesPage(entriesMeta.page + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {flow === "CHOICE" ? <FlowPickerModal onClose={() => setFlow(null)} onPick={setFlow} /> : null}
      {flow === "INCLUSAO" || flow === "MODIFICACAO" ? (
        <RequestModal initialMode={flow} token={token} rcas={rcas} onClose={() => setFlow(null)} onCreated={loadAll} />
      ) : null}
      {flow === "IMPORT" ? <ImportModal token={token} onClose={() => setFlow(null)} onCreated={loadAll} /> : null}
      {reviewDialog ? (
        <ReviewDialog
          request={reviewDialog.request}
          decision={reviewDialog.decision}
          saving={reviewSaving}
          onCancel={() => setReviewDialog(null)}
          onConfirm={confirmReview}
        />
      ) : null}
    </div>
  );
}
