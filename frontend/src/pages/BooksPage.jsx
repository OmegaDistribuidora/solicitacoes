import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiFormData, apiJson } from "../services/api";

function photoTypeLabel(value) {
  return value === "FRENTE_LOJA" ? "Frente de Loja" : value === "ACAO" ? "Ação" : "Capa";
}

function initialRecord(record, index) {
  return {
    key: record?.id || `new-${Date.now()}-${index}`,
    id: record?.id,
    promotor: record?.promotor || "",
    codigoCliente: record?.codigoCliente || "",
    existingPhotos: (record?.anexos || []).filter((item) => item.tipo !== "CAPA"),
    newPhotos: []
  };
}

function BookForm({ book, token, onClose, onSaved }) {
  const isEditing = Boolean(book?.id);
  const existingCover = book?.anexos?.find((item) => item.tipo === "CAPA") || null;
  const [nome, setNome] = useState(book?.nome || "");
  const [codigoFornecedor, setCodigoFornecedor] = useState(book?.codigoFornecedor || "");
  const [mesAno, setMesAno] = useState(book?.dataPeriodo ? String(book.dataPeriodo).slice(0, 7) : "");
  const [cover, setCover] = useState(null);
  const [keepCover, setKeepCover] = useState(existingCover);
  const [records, setRecords] = useState((book?.registros?.length ? book.registros : [null]).map(initialRecord));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateRecord(index, patch) {
    setRecords((current) => current.map((record, recordIndex) => (recordIndex === index ? { ...record, ...patch } : record)));
  }

  function addPhotos(index, type, files) {
    const record = records[index];
    const additions = Array.from(files).map((file) => ({ key: `${Date.now()}-${crypto.randomUUID()}`, file, type }));
    updateRecord(index, { newPhotos: [...record.newPhotos, ...additions] });
  }

  function removeRecord(index) {
    if (records.length === 1) return;
    setRecords((current) => current.filter((_record, recordIndex) => recordIndex !== index));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = new FormData();
      data.append(
        "dados",
        JSON.stringify({
          nome,
          codigoFornecedor: Number(codigoFornecedor),
          mesAno,
          capaMantidaId: cover ? null : keepCover?.id || null,
          registros: records.map((record) => ({
            id: record.id,
            promotor: record.promotor,
            codigoCliente: Number(record.codigoCliente),
            anexosMantidos: record.existingPhotos.map((photo) => photo.id)
          }))
        })
      );
      if (cover) data.append("capa", cover);
      records.forEach((record, index) => {
        record.newPhotos.forEach((photo) => data.append(`foto:${index}:${photo.type}`, photo.file));
      });
      const result = await apiFormData(isEditing ? `/modules/promotores/books/${book.id}` : "/modules/promotores/books", {
        token,
        method: isEditing ? "PUT" : "POST",
        data
      });
      await onSaved(result.book);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card modal-card-wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><div className="eyebrow">Promotores / Books</div><h2>{isEditing ? "Editar book" : "Criar novo book"}</h2></div>
          <button type="button" className="icon-btn" onClick={onClose}>x</button>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <div className="form-two">
            <label>Nome do book<input required maxLength={200} value={nome} onChange={(event) => setNome(event.target.value)} /></label>
            <label>Código de fornecedor<input required type="number" min="1" step="1" value={codigoFornecedor} onChange={(event) => setCodigoFornecedor(event.target.value)} /></label>
          </div>
          <div className="form-two">
            <label>Período<input required type="month" value={mesAno} onChange={(event) => setMesAno(event.target.value)} /></label>
            <label className="file-drop">Capa (PNG ou JPEG/JPG)<input type="file" accept="image/png,image/jpeg" required={!keepCover && !cover} onChange={(event) => setCover(event.target.files?.[0] || null)} /><span>Selecionar capa</span><strong>{cover?.name || keepCover?.nomeOriginal || "Nenhuma imagem selecionada"}</strong></label>
          </div>
          {keepCover && !cover ? <div className="book-cover-current"><img src={keepCover.url} alt="Capa atual" /><button type="button" className="danger-btn compact-btn" onClick={() => setKeepCover(null)}>Remover capa</button></div> : null}

          <div className="section-header"><div><h3>Registros</h3><p className="muted small">Cada registro representa uma loja e pode conter várias fotos.</p></div><button type="button" className="secondary-btn" onClick={() => setRecords((current) => [...current, initialRecord(null, current.length)])}>+ Registro</button></div>
          <div className="book-record-list">
            {records.map((record, index) => (
              <section className="book-record-card" key={record.key}>
                <div className="section-header"><h3>Registro {index + 1}</h3><button type="button" className="danger-btn compact-btn" disabled={records.length === 1} onClick={() => removeRecord(index)}>Remover registro</button></div>
                <div className="form-two">
                  <label>Promotor<input required value={record.promotor} onChange={(event) => updateRecord(index, { promotor: event.target.value })} /></label>
                  <label>Código do cliente<input required type="number" min="1" step="1" value={record.codigoCliente} onChange={(event) => updateRecord(index, { codigoCliente: event.target.value })} /></label>
                </div>
                {record.existingPhotos.length ? <div className="book-photo-grid">{record.existingPhotos.map((photo) => <figure className="book-photo" key={photo.id}><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)}</figcaption><button type="button" className="danger-btn compact-btn" onClick={() => updateRecord(index, { existingPhotos: record.existingPhotos.filter((item) => item.id !== photo.id) })}>Remover</button></figure>)}</div> : null}
                <div className="photo-upload-grid">
                  <label className="file-drop"><strong>Fotos de Frente de Loja</strong><input type="file" multiple accept="image/png,image/jpeg" onChange={(event) => { addPhotos(index, "FRENTE_LOJA", event.target.files || []); event.target.value = ""; }} /><span>Adicionar fotos</span><small>PNG ou JPEG/JPG, até 25 MB por imagem</small></label>
                  <label className="file-drop"><strong>Fotos de Ação</strong><input type="file" multiple accept="image/png,image/jpeg" onChange={(event) => { addPhotos(index, "ACAO", event.target.files || []); event.target.value = ""; }} /><span>Adicionar fotos</span><small>PNG ou JPEG/JPG, até 25 MB por imagem</small></label>
                </div>
                {record.newPhotos.length ? <div className="new-photo-list">{record.newPhotos.map((photo) => <div className="mini-row" key={photo.key}><span>{photo.file.name}</span><strong>{photoTypeLabel(photo.type)}</strong><button type="button" className="danger-btn compact-btn" onClick={() => updateRecord(index, { newPhotos: record.newPhotos.filter((item) => item.key !== photo.key) })}>Remover</button></div>)}</div> : null}
              </section>
            ))}
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions"><button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar book"}</button><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function BookDetails({ book, onClose, onEdit, onDelete }) {
  const cover = book.anexos?.find((item) => item.tipo === "CAPA");
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card modal-card-wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><div className="eyebrow">Book #{book.id}</div><h2>{book.nome}</h2><p className="muted">Fornecedor {book.codigoFornecedor} · {book.periodo}</p></div><button type="button" className="icon-btn" onClick={onClose}>x</button></div>
        {cover ? <img className="book-detail-cover" src={cover.url} alt={`Capa de ${book.nome}`} /> : null}
        <div className="book-record-list">{book.registros?.map((record) => <section className="book-record-card" key={record.id}><h3>{record.codigoCliente} · {record.promotor}</h3><div className="book-photo-grid">{record.anexos?.map((photo) => <a className="book-photo" href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)}</figcaption></a>)}</div></section>)}</div>
        <div className="modal-actions"><button type="button" className="primary-btn" onClick={onEdit}>Editar</button><button type="button" className="danger-btn" onClick={onDelete}>Excluir book</button><button type="button" className="secondary-btn" onClick={onClose}>Fechar</button></div>
      </section>
    </div>
  );
}

export default function BooksPage() {
  const { token } = useAuth();
  const [books, setBooks] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    try { const payload = await apiJson(`/modules/promotores/books/${id}`, { token }); setSelected(payload.book); } catch (requestError) { setError(requestError.message); }
  }
  async function removeBook(book) {
    if (!window.confirm(`Excluir definitivamente o book "${book.nome}" e todas as imagens?`)) return;
    try { await apiJson(`/modules/promotores/books/${book.id}`, { method: "DELETE", token }); setSelected(null); await load(); } catch (requestError) { setError(requestError.message); }
  }

  return (
    <div className="page-stack">
      <section className="page-card compact-page-header"><div className="section-header"><div><div className="eyebrow">Promotores</div><h2>Books</h2><p className="muted">Books de ações e frentes de loja organizados por fornecedor e período.</p></div><button className="primary-btn" onClick={() => setEditing(null)}>Criar novo book</button></div>{error ? <p className="error-text">{error}</p> : null}</section>
      <section className="table-card"><div className="toolbar"><div><h2>Últimos books</h2><p className="muted small">{pageInfo.total} book(s) cadastrado(s).</p></div><div className="inline-actions"><input placeholder="Nome, fornecedor ou período" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(query); } }} /><button className="secondary-btn" onClick={() => { setPage(1); setAppliedQuery(query); }}>Buscar</button></div></div>
        {loading ? <div className="empty-state">Carregando books...</div> : books.length ? <div className="book-grid">{books.map((book) => { const cover = book.anexos?.[0]; return <button type="button" className="book-card" key={book.id} onClick={() => openBook(book.id)}>{cover ? <img src={cover.url} alt="" /> : <div className="book-card-placeholder">Sem capa</div>}<span><strong>{book.nome}</strong><small>Fornecedor {book.codigoFornecedor} · {book.periodo}</small><small>{book._count?.registros || 0} registro(s) · {Math.max(0, (book._count?.anexos || 0) - 1)} foto(s)</small></span></button>; })}</div> : <div className="empty-state">Nenhum book encontrado.</div>}
        <div className="pagination-bar"><button className="secondary-btn compact-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {page} de {pageInfo.totalPages}</span><button className="secondary-btn compact-btn" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</button></div>
      </section>
      {selected ? <BookDetails book={selected} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => removeBook(selected)} /> : null}
      {editing !== undefined ? <BookForm book={editing} token={token} onClose={() => setEditing(undefined)} onSaved={async (book) => { setEditing(undefined); setSelected(book); await load(); }} /> : null}
    </div>
  );
}
