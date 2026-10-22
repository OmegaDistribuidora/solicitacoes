import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiFormData, apiJson } from "../services/api";

const MANAGER_ROLES = new Set(["ADMIN", "ANALYST", "MERCH_COORDINATOR"]);
const REVIEWER_ROLES = new Set(["ADMIN", "SUPERVISOR"]);

function photoTypeLabel(value) {
  return value === "FRENTE_LOJA" ? "Frente de Loja" : value === "ACAO" ? "Ação" : "Capa";
}

function statusLabel(value) {
  if (value === "CLOSED") return "Encerrado";
  if (value === "APPROVED") return "Aprovado";
  if (value === "REJECTED") return "Recusado";
  return "Ativo";
}

function submissionStatusLabel(value) {
  if (value === "ACCEPTED") return "Aceito";
  if (value === "REJECTED") return "Recusado — envie novamente";
  return "Aguardando análise";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function exportBookPdf(book) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("O navegador bloqueou a janela de exportação. Libere pop-ups e tente novamente.");
  popup.opener = null;
  const cover = book.anexos?.find((item) => item.tipo === "CAPA");
  const records = (book.registros || []).map((record, index) => `
    <section class="record">
      <header><span>REGISTRO ${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(record.codigoCliente)} · ${escapeHtml(record.promotor)}</h2></header>
      <div class="photos">${(record.anexos || []).map((photo) => `<figure><img src="${escapeHtml(photo.url)}" alt=""><figcaption>${escapeHtml(photoTypeLabel(photo.tipo))}</figcaption></figure>`).join("")}</div>
    </section>`).join("");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(book.nome)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#091d45;font-family:Arial,sans-serif}.cover,.record{min-height:270mm;page-break-after:always;display:flex;flex-direction:column}.cover{justify-content:center;text-align:center}.cover img{width:100%;max-height:210mm;object-fit:contain}.cover h1{font-size:30px;margin:18px 0 6px}.cover p{font-size:15px;color:#5f6b82}.record header{border-left:7px solid #f45b16;padding:4px 0 4px 16px;margin-bottom:18px}.record header span{font-size:10px;letter-spacing:2px;color:#c83e08}.record h2{font-size:22px;margin:5px 0}.photos{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.photos figure{margin:0;border:1px solid #d9dce4;padding:7px;break-inside:avoid}.photos img{width:100%;height:108mm;object-fit:contain;background:#f3efe3}.photos figcaption{text-align:center;font-weight:bold;padding-top:6px;font-size:12px}.record:last-child{page-break-after:auto}
  </style></head><body><section class="cover">${cover ? `<img src="${escapeHtml(cover.url)}" alt="">` : ""}<h1>${escapeHtml(book.nome)}</h1><p>Fornecedor ${escapeHtml(book.codigoFornecedor)} · ${escapeHtml(book.periodo)}</p></section>${records}</body></html>`);
  popup.document.close();
  const printWhenReady = () => {
    const images = [...popup.document.images];
    Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; })))
      .then(() => { popup.focus(); popup.print(); });
  };
  if (popup.document.readyState === "complete") printWhenReady();
  else popup.addEventListener("load", printWhenReady, { once: true });
}

function BookForm({ book, token, onClose, onSaved }) {
  const isEditing = Boolean(book?.id);
  const existingCover = book?.anexos?.find((item) => item.tipo === "CAPA") || null;
  const [nome, setNome] = useState(book?.nome || "");
  const [codigoFornecedor, setCodigoFornecedor] = useState(book?.codigoFornecedor || "");
  const [mesAno, setMesAno] = useState(book?.dataPeriodo ? String(book.dataPeriodo).slice(0, 7) : "");
  const [cover, setCover] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = new FormData();
      data.append("dados", JSON.stringify({ nome, codigoFornecedor: Number(codigoFornecedor), mesAno, capaMantidaId: cover ? null : existingCover?.id || null }));
      if (cover) data.append("capa", cover);
      const result = await apiFormData(isEditing ? `/modules/promotores/books/${book.id}` : "/modules/promotores/books", { token, method: isEditing ? "PUT" : "POST", data });
      await onSaved(result.book);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-header"><div><div className="eyebrow">Promotores / Books</div><h2>{isEditing ? "Editar book" : "Criar novo book"}</h2></div><button type="button" className="icon-btn" onClick={onClose}>x</button></div>
        <form className="form-stack" onSubmit={submit}>
          <div className="form-two">
            <label>Nome do book<input required maxLength={200} value={nome} onChange={(event) => setNome(event.target.value)} /></label>
            <label>Código de fornecedor<input required type="number" min="1" step="1" value={codigoFornecedor} onChange={(event) => setCodigoFornecedor(event.target.value)} /></label>
          </div>
          <div className="form-two">
            <label>Período<input required type="month" value={mesAno} onChange={(event) => setMesAno(event.target.value)} /></label>
            <label className="file-drop">Capa (PNG ou JPEG/JPG)<input type="file" accept="image/png,image/jpeg" required={!existingCover && !cover} onChange={(event) => setCover(event.target.files?.[0] || null)} /><span>Selecionar capa</span><strong>{cover?.name || existingCover?.nomeOriginal || "Nenhuma imagem selecionada"}</strong></label>
          </div>
          {existingCover && !cover ? <div className="book-cover-current"><img src={existingCover.url} alt="Capa atual" /></div> : null}
          <p className="muted small">Os registros serão enviados pelos promotores enquanto o book estiver ativo.</p>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions"><button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar book"}</button><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function SubmissionForm({ book, token, onClose, onSaved }) {
  const [codigoCliente, setCodigoCliente] = useState("");
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addPhotos(type, fileList) {
    const selectedFiles = Array.from(fileList || []);
    if (!selectedFiles.length) return;
    const invalidFile = selectedFiles.find((file) => !["image/png", "image/jpeg"].includes(file.type));
    if (invalidFile) {
      setError(`O arquivo "${invalidFile.name}" não é PNG ou JPEG/JPG.`);
      return;
    }
    const additions = selectedFiles.map((file) => ({ key: crypto.randomUUID(), file, type }));
    setPhotos((current) => [...current, ...additions]);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!photos.length) { setError("Adicione pelo menos uma foto."); return; }
    setSaving(true);
    setError("");
    try {
      const data = new FormData();
      data.append("dados", JSON.stringify({ codigoCliente: Number(codigoCliente) }));
      photos.forEach((photo) => data.append(`foto:${photo.type}`, photo.file));
      await apiFormData(`/modules/promotores/books/${book.id}/envios`, { token, data });
      await onSaved();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-header"><div><div className="eyebrow">Enviar para {book.nome}</div><h2>Novo registro</h2><p className="muted">Seu nome de exibição será usado automaticamente como promotor.</p></div><button type="button" className="icon-btn" onClick={onClose}>x</button></div>
        <form className="form-stack" onSubmit={submit}>
          <label>Código do cliente<input required type="number" min="1" step="1" value={codigoCliente} onChange={(event) => setCodigoCliente(event.target.value)} /></label>
          <div className="photo-upload-grid">
            <label className="file-drop"><strong>Fotos de Frente de Loja</strong><input type="file" multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); addPhotos("FRENTE_LOJA", files); event.currentTarget.value = ""; }} /><span>Adicionar fotos</span></label>
            <label className="file-drop"><strong>Fotos de Ação</strong><input type="file" multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); addPhotos("ACAO", files); event.currentTarget.value = ""; }} /><span>Adicionar fotos</span></label>
          </div>
          {photos.length ? <div className="new-photo-list">{photos.map((photo) => <div className="mini-row" key={photo.key}><span>{photo.file.name}</span><strong>{photoTypeLabel(photo.type)}</strong><button type="button" className="danger-btn compact-btn" onClick={() => setPhotos((current) => current.filter((item) => item.key !== photo.key))}>Remover</button></div>)}</div> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions"><button className="primary-btn" type="submit" disabled={saving}>{saving ? "Enviando..." : "Enviar para aprovação"}</button><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function BookDetails({ book, role, busy, error, onClose, onEdit, onDelete, onSubmitRecord, onReviewSubmission, onChangeStatus, onMoveRecord, onExport }) {
  const cover = book.anexos?.find((item) => item.tipo === "CAPA");
  const canManage = MANAGER_ROLES.has(role);
  const canReviewBook = REVIEWER_ROLES.has(role);
  const isPromoter = role === "PROMOTER";
  const pendingSubmissions = (book.envios || []).filter((item) => item.status === "PENDING");
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card modal-card-wide book-workflow-modal" role="dialog" aria-modal="true">
        <div className="modal-header"><div><div className="eyebrow">Book #{book.id}</div><h2>{book.nome}</h2><p className="muted">Fornecedor {book.codigoFornecedor} · {book.periodo}</p></div><div className="inline-actions"><span className={`status-pill status-${book.status?.toLowerCase()}`}>{statusLabel(book.status)}</span><button type="button" className="icon-btn" onClick={onClose}>x</button></div></div>
        {error ? <p className="error-text">{error}</p> : null}
        {book.workflow?.motivoRevisao ? <div className="callout-card"><strong>Motivo da recusa</strong><p className="muted">{book.workflow.motivoRevisao}</p></div> : null}
        {cover ? <img className="book-detail-cover" src={cover.url} alt={`Capa de ${book.nome}`} /> : null}

        {canManage && pendingSubmissions.length ? <section className="workflow-section"><div className="section-header"><div><h3>Registros aguardando aprovação</h3><p className="muted small">Confira cliente, promotor e fotos antes de aceitar.</p></div><span className="status-pill status-pending">{pendingSubmissions.length} pendente(s)</span></div><div className="book-record-list">{pendingSubmissions.map((submission) => <section className="book-record-card submission-card" key={submission.id}><div className="section-header"><div><div className="eyebrow">Envio #{submission.id}</div><h3>{submission.codigoCliente} · {submission.promotorNome}</h3></div><div className="inline-actions"><button className="primary-btn compact-btn" disabled={busy} onClick={() => onReviewSubmission(submission, "ACCEPTED")}>Aceitar</button><button className="danger-btn compact-btn" disabled={busy} onClick={() => onReviewSubmission(submission, "REJECTED")}>Recusar</button></div></div><div className="book-photo-grid">{submission.anexos?.map((photo) => <a className="book-photo" href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)}</figcaption></a>)}</div></section>)}</div></section> : null}

        <section className="workflow-section"><div className="book-record-list">{book.registros?.length ? book.registros.map((record, index) => <section className="book-record-card" key={record.id}><div className="section-header"><h3>{index + 1}. {record.codigoCliente} · {record.promotor}</h3>{canManage && book.registros.length > 1 ? <div className="order-controls"><button type="button" className="secondary-btn compact-btn" disabled={busy || index === 0} onClick={() => onMoveRecord(index, -1)}>↑</button><button type="button" className="secondary-btn compact-btn" disabled={busy || index === book.registros.length - 1} onClick={() => onMoveRecord(index, 1)}>↓</button></div> : null}</div><div className="book-photo-grid">{record.anexos?.map((photo) => <a className="book-photo" href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)}</figcaption></a>)}</div></section>) : <div className="empty-state">Nenhum registro aceito ainda.</div>}</div></section>

        {isPromoter && book.envios?.length ? <section className="workflow-section"><h3>Meus envios</h3><div className="submission-history">{book.envios.map((submission) => <div className="mini-row" key={submission.id}><span>Cliente {submission.codigoCliente}</span><strong>{submissionStatusLabel(submission.status)}</strong>{submission.motivoRevisao ? <small>{submission.motivoRevisao}</small> : null}</div>)}</div></section> : null}

        <div className="modal-actions book-action-bar">
          {isPromoter && book.status === "ACTIVE" ? <button type="button" className="primary-btn" onClick={onSubmitRecord}>+ Enviar registro</button> : null}
          {canManage && book.status === "ACTIVE" ? <><button type="button" className="primary-btn" onClick={onEdit}>Editar dados</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => onChangeStatus("CLOSED")}>Encerrar book</button><button type="button" className="danger-btn" disabled={busy} onClick={onDelete}>Excluir book</button></> : null}
          {canManage && ["CLOSED", "REJECTED"].includes(book.status) ? <button type="button" className="secondary-btn" disabled={busy} onClick={() => onChangeStatus("ACTIVE")}>Reabrir book</button> : null}
          {canReviewBook && book.status === "CLOSED" ? <><button type="button" className="primary-btn" disabled={busy} onClick={() => onChangeStatus("APPROVED")}>Aprovar book</button><button type="button" className="danger-btn" disabled={busy} onClick={() => onChangeStatus("REJECTED")}>Recusar book</button></> : null}
          {book.status !== "ACTIVE" && (canManage || canReviewBook) ? <button type="button" className="secondary-btn" onClick={onExport}>Exportar PDF</button> : null}
          <button type="button" className="secondary-btn" onClick={onClose}>Fechar</button>
        </div>
      </section>
    </div>
  );
}

const BooksPage = forwardRef(function BooksPage(_, ref) {
  const { token, user } = useAuth();
  const [books, setBooks] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [submittingRecord, setSubmittingRecord] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const canManage = MANAGER_ROLES.has(user?.role);

  useImperativeHandle(ref, () => ({ openCreate() { if (canManage) setEditing(null); } }), [canManage]);

  const listParams = useMemo(() => new URLSearchParams({ q: appliedQuery, page: String(page), pageSize: "20" }), [appliedQuery, page]);
  async function load() {
    setLoading(true); setError("");
    try {
      const payload = await apiJson(`/modules/promotores/books?${listParams}`, { token });
      setBooks(payload.books || []); setPageInfo({ total: payload.total || 0, totalPages: payload.totalPages || 1 });
    } catch (requestError) { setError(requestError.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token, listParams]);

  async function openBook(id) {
    setDetailError("");
    try { const payload = await apiJson(`/modules/promotores/books/${id}`, { token }); setSelected(payload.book); } catch (requestError) { setError(requestError.message); }
  }

  async function refreshSelected() {
    if (!selected?.id) return;
    const payload = await apiJson(`/modules/promotores/books/${selected.id}`, { token });
    setSelected(payload.book);
    await load();
  }

  async function removeBook(book) {
    if (!window.confirm(`Excluir definitivamente o book "${book.nome}" e todas as imagens?`)) return;
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${book.id}`, { method: "DELETE", token }); setSelected(null); await load(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function reviewSubmission(submission, decisao) {
    const motivo = decisao === "REJECTED" ? window.prompt("Motivo da recusa (opcional):", "") : "";
    if (decisao === "REJECTED" && motivo === null) return;
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/envios/${submission.id}/revisao`, { method: "PATCH", token, data: { decisao, motivo } }); await refreshSelected(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function changeStatus(status) {
    const confirmation = status === "CLOSED" ? "Encerrar este book e impedir novos envios?" : status === "ACTIVE" ? "Reabrir este book para novos envios?" : status === "APPROVED" ? "Aprovar este book?" : "Recusar este book?";
    if (!window.confirm(confirmation)) return;
    const motivo = status === "REJECTED" ? window.prompt("Motivo da recusa (opcional):", "") : "";
    if (status === "REJECTED" && motivo === null) return;
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/status`, { method: "PATCH", token, data: { status, motivo } }); await refreshSelected(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function moveRecord(index, direction) {
    const reordered = [...selected.registros];
    const [record] = reordered.splice(index, 1);
    reordered.splice(index + direction, 0, record);
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/registros/ordem`, { method: "PATCH", token, data: { registroIds: reordered.map((item) => item.id) } }); setSelected((current) => ({ ...current, registros: reordered })); await load(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  function handleExport() {
    try { exportBookPdf(selected); } catch (exportError) { setDetailError(exportError.message); }
  }

  return (
    <div className="page-stack">
      <section className="table-card"><div className="toolbar"><div><h2>{user?.role === "PROMOTER" ? "Books ativos" : "Últimos books"}</h2><p className="muted small">{pageInfo.total} book(s) disponível(is).</p></div><div className="inline-actions"><input placeholder="Nome, fornecedor ou período" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(query); } }} /><button className="secondary-btn" onClick={() => { setPage(1); setAppliedQuery(query); }}>Buscar</button></div></div>
        {error ? <p className="error-text">{error}</p> : null}
        {loading ? <div className="empty-state">Carregando books...</div> : books.length ? <div className="book-grid">{books.map((book) => { const cover = book.anexos?.[0]; return <button type="button" className="book-card" key={book.id} onClick={() => openBook(book.id)}>{cover ? <img src={cover.url} alt="" /> : <div className="book-card-placeholder">Sem capa</div>}<span><span className={`status-pill status-${book.status?.toLowerCase()}`}>{statusLabel(book.status)}</span><strong>{book.nome}</strong><small>Fornecedor {book.codigoFornecedor} · {book.periodo}</small>{user?.role === "PROMOTER" ? <small>Seus envios: {book._count?.envios || 0}</small> : <small>{book._count?.registros || 0} registro(s) · {Math.max(0, (book._count?.anexos || 0) - 1)} foto(s)</small>}</span></button>; })}</div> : <div className="empty-state">Nenhum book encontrado.</div>}
        <div className="pagination-bar"><button className="secondary-btn compact-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {page} de {pageInfo.totalPages}</span><button className="secondary-btn compact-btn" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</button></div>
      </section>
      {selected ? <BookDetails book={selected} role={user?.role} busy={busy} error={detailError} onClose={() => { setSelected(null); setDetailError(""); }} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => removeBook(selected)} onSubmitRecord={() => setSubmittingRecord(true)} onReviewSubmission={reviewSubmission} onChangeStatus={changeStatus} onMoveRecord={moveRecord} onExport={handleExport} /> : null}
      {editing !== undefined ? <BookForm book={editing} token={token} onClose={() => setEditing(undefined)} onSaved={async (book) => { setEditing(undefined); await load(); await openBook(book.id); }} /> : null}
      {submittingRecord && selected ? <SubmissionForm book={selected} token={token} onClose={() => setSubmittingRecord(false)} onSaved={async () => { setSubmittingRecord(false); await refreshSelected(); }} /> : null}
    </div>
  );
});

export default BooksPage;
