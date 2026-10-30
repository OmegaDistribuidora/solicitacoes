import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { apiFormData, apiJson } from "../services/api";
import bookBackground117 from "../assets/book-backgrounds/117.png";
import bookBackground1630 from "../assets/book-backgrounds/1630.png";
import bookBackground1968 from "../assets/book-backgrounds/1968.png";
import bookBackground3609 from "../assets/book-backgrounds/3609.png";
import bookBackground4698 from "../assets/book-backgrounds/4698.png";
import bookBackground4701 from "../assets/book-backgrounds/4701.png";
import bookBackground4750 from "../assets/book-backgrounds/4750.png";
import bookBackground5569 from "../assets/book-backgrounds/5569.png";

const MANAGER_ROLES = new Set(["ADMIN", "MERCH_COORDINATOR"]);
const BOOK_DELETER_ROLES = new Set(["ADMIN", "MERCH_COORDINATOR"]);
const BOOK_PAGE_BACKGROUNDS = {
  117: bookBackground117,
  1630: bookBackground1630,
  1968: bookBackground1968,
  3609: bookBackground3609,
  4698: bookBackground4698,
  4701: bookBackground4701,
  4750: bookBackground4750,
  5569: bookBackground5569
};

const SUPPLIERS = [
  { code: 117, name: "Bombril", layout: "four-actions", actionOnly: true, covers: ["/book-templates/117/capa-1.png", "/book-templates/117/capa-2.png"], endings: ["/book-templates/117/fim-1.png", "/book-templates/117/fim-2.png"] },
  { code: 1630, name: "Panasonic", layout: "store-only", covers: ["/book-templates/1630/capa-1.png"], endings: [] },
  { code: 1968, name: "JDE", layout: "store-only", covers: ["/book-templates/1968/capa-1.png"], endings: ["/book-templates/1968/fim-1.png"] },
  { code: 3609, name: "Mili", layout: "four-actions", actionOnly: true, covers: ["/book-templates/3609/capa-1.png"], endings: ["/book-templates/3609/fim-1.png"] },
  { code: 4698, name: "Assim", layout: "split", covers: ["/book-templates/4698/capa-1.png", "/book-templates/4698/capa-2.png"], endings: ["/book-templates/4698/fim-1.png"] },
  { code: 4701, name: "Albany", layout: "split", covers: ["/book-templates/4701/capa-1.png", "/book-templates/4701/capa-2.png"], endings: ["/book-templates/4701/fim-1.png"] },
  { code: 4750, name: "Mat Inset", layout: "split", covers: ["/book-templates/4750/capa-1.png", "/book-templates/4750/capa-2.png"], endings: ["/book-templates/4750/fim-1.png"] },
  { code: 5569, name: "Gallo", layout: "split-no-promoter", covers: ["/book-templates/5569/capa-1.png"], endings: ["/book-templates/5569/fim-1.png"] }
];

function supplierFor(code) {
  return SUPPLIERS.find((supplier) => supplier.code === Number(code));
}

function bookCoverUrl(book) {
  return supplierFor(book?.codigoFornecedor)?.covers?.[0] || book?.anexos?.find((item) => item.tipo === "CAPA")?.url || "";
}

function photoTypeLabel(value) {
  return value === "FRENTE_LOJA" ? "Frente de Loja" : value === "ACAO" ? "Ação" : "Capa";
}

function statusLabel(value) {
  return value === "ACTIVE" ? "Ativo" : "Encerrado";
}

function submissionStatusLabel(value) {
  if (value === "ACCEPTED") return "Aceito";
  if (value === "REJECTED") return "Recusado — envie novamente";
  return "Aguardando análise";
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

async function loadPdfImage(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Não foi possível carregar uma imagem do book (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawContainedImage(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  context.drawImage(image, x + (width - renderedWidth) / 2, y + (height - renderedHeight) / 2, renderedWidth, renderedHeight);
}

function drawImageCard(context, image, x, y, width, height) {
  context.fillStyle = "rgba(255,255,255,0.96)";
  roundedRect(context, x, y, width, height, 12);
  context.fill();
  context.strokeStyle = "rgba(9,29,69,0.18)";
  context.lineWidth = 2;
  context.stroke();
  drawContainedImage(context, image, x + 10, y + 10, width - 20, height - 20);
}

function drawPhotoGrid(context, images, x, y, width, height) {
  if (!images.length) {
    context.fillStyle = "rgba(255,255,255,0.86)";
    roundedRect(context, x, y, width, height, 12);
    context.fill();
    context.fillStyle = "#64708a";
    context.font = '700 24px "Trebuchet MS", Arial, sans-serif';
    context.textAlign = "center";
    context.fillText("Sem foto", x + width / 2, y + height / 2);
    context.textAlign = "left";
    return;
  }
  const columns = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
  const rows = Math.ceil(images.length / columns);
  const gap = 16;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = (height - gap * (rows - 1)) / rows;
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    drawImageCard(context, image, x + column * (cardWidth + gap), y + row * (cardHeight + gap), cardWidth, cardHeight);
  });
}

function fitText(context, text, maxWidth, initialSize, weight = 700) {
  let size = initialSize;
  do {
    context.font = `${weight} ${size}px "Trebuchet MS", Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth) return;
    size -= 2;
  } while (size > 18);
}

function safePdfFilename(value) {
  const cleanName = String(value || "book")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleanName || "book"}.pdf`;
}

function formatBookPeriod(book) {
  const fullMonthNames = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const isoMatch = /^(\d{4})-(\d{2})/.exec(String(book.dataPeriodo || ""));
  if (isoMatch) return `${fullMonthNames[Number(isoMatch[2]) - 1]} de ${isoMatch[1]}`;
  const shortMonthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const periodMatch = /^([a-zç]{3})\/(\d{4})$/i.exec(String(book.periodo || ""));
  const monthIndex = periodMatch ? shortMonthNames.indexOf(periodMatch[1].toLowerCase()) : -1;
  return monthIndex >= 0 ? `${fullMonthNames[monthIndex]} de ${periodMatch[2]}` : String(book.periodo || "");
}

async function exportBookPdf(book) {
  const supplier = supplierFor(book.codigoFornecedor);
  const pageBackground = BOOK_PAGE_BACKGROUNDS[String(book.codigoFornecedor)];
  if (!supplier || !pageBackground) {
    throw new Error(`Não existe um padrão de página cadastrado para o fornecedor ${book.codigoFornecedor}.`);
  }
  const [{ jsPDF }, backgroundImage, coverImages, endingImages] = await Promise.all([
    import("jspdf"),
    loadPdfImage(pageBackground),
    Promise.all(supplier.covers.map(loadPdfImage)),
    Promise.all(supplier.endings.map(loadPdfImage))
  ]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const canvas = document.createElement("canvas");
  canvas.width = 1684;
  canvas.height = 1191;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("O navegador não conseguiu preparar a exportação do PDF.");

  let pageCount = 0;
  function commitPage(quality = 0.9) {
    if (pageCount) pdf.addPage("a4", "landscape");
    pdf.addImage(canvas.toDataURL("image/jpeg", quality), "JPEG", 0, 0, 297, 210, undefined, "FAST");
    pageCount += 1;
  }
  function drawFixedPage(image, showPeriod = false) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawContainedImage(context, image, 0, 0, canvas.width, canvas.height);
    const period = showPeriod ? formatBookPeriod(book) : "";
    if (period) {
      context.font = '700 34px "Trebuchet MS", Arial, sans-serif';
      const periodWidth = Math.max(390, context.measureText(period).width + 90);
      const periodX = (canvas.width - periodWidth) / 2;
      const periodY = canvas.height - 105;
      context.fillStyle = "rgba(9,29,69,0.88)";
      roundedRect(context, periodX, periodY, periodWidth, 66, 33);
      context.fill();
      context.fillStyle = "#ffffff";
      context.textAlign = "center";
      context.fillText(period, canvas.width / 2, periodY + 45);
      context.textAlign = "left";
    }
    commitPage(0.94);
  }
  coverImages.forEach((image, index) => drawFixedPage(image, index === 0));

  if (supplier.layout === "four-actions") {
    const actionItems = (book.registros || []).flatMap((record) =>
      (record.anexos || []).filter((photo) => photo.tipo === "ACAO").map((photo) => ({ record, photo }))
    );
    for (let offset = 0; offset < actionItems.length; offset += 4) {
      const pageItems = actionItems.slice(offset, offset + 4);
      const images = await Promise.all(pageItems.map((item) => loadPdfImage(item.photo.url)));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
      const left = 76;
      const top = 248;
      const gap = 18;
      const cardWidth = (canvas.width - left * 2 - gap * 3) / 4;
      pageItems.forEach((item, index) => {
        const x = left + index * (cardWidth + gap);
        const record = item.record;
        context.fillStyle = "rgba(55,133,194,0.94)";
        roundedRect(context, x, top, cardWidth, 126, 18);
        context.fill();
        context.fillStyle = "#ffffff";
        context.textAlign = "center";
        fitText(context, String(record.clienteNome || "Cliente não encontrado"), cardWidth - 28, 24, 800);
        context.fillText(String(record.clienteNome || "Cliente não encontrado").toUpperCase(), x + cardWidth / 2, top + 35);
        fitText(context, String(record.clienteCidade || "Cidade não informada"), cardWidth - 28, 20, 700);
        context.fillText(`CIDADE: ${String(record.clienteCidade || "Cidade não informada").toUpperCase()}`, x + cardWidth / 2, top + 71);
        fitText(context, String(record.promotor || ""), cardWidth - 28, 20, 700);
        context.fillText(`PROMOTOR: ${String(record.promotor || "").toUpperCase()}`, x + cardWidth / 2, top + 105);
        context.textAlign = "left";
        drawImageCard(context, images[index], x, top + 145, cardWidth, canvas.height - top - 225);
      });
      commitPage();
    }
  } else {
    for (const record of (book.registros || [])) {
      const frontPhotos = (record.anexos || []).filter((photo) => photo.tipo === "FRENTE_LOJA");
      const actionPhotos = (record.anexos || []).filter((photo) => photo.tipo === "ACAO");
      const [frontImages, actionImages] = await Promise.all([
        Promise.all(frontPhotos.map((photo) => loadPdfImage(photo.url))),
        Promise.all(actionPhotos.map((photo) => loadPdfImage(photo.url)))
      ]);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);

      const headerY = 205;
      const headerX = 115;
      const headerWidth = canvas.width - 230;
      context.fillStyle = "rgba(255,255,255,0.92)";
      roundedRect(context, headerX, headerY, headerWidth, 88, 14);
      context.fill();
      context.fillStyle = "#091d45";
      context.textAlign = "center";
      const customerName = String(record.clienteNome || "Cliente não encontrado");
      const metadata = supplier.layout === "store-only"
        ? customerName
        : supplier.layout === "split-no-promoter"
          ? `${customerName} · ${record.clienteCidade || "Cidade não informada"}`
          : `${customerName} · ${record.clienteCidade || "Cidade não informada"} · Promotor: ${record.promotor || ""}`;
      fitText(context, metadata, headerWidth - 50, 30, 800);
      context.fillText(metadata, canvas.width / 2, headerY + 56);
      context.textAlign = "left";

      const contentY = headerY + 112;
      const contentHeight = canvas.height - contentY - 95;
      const leftX = 95;
      const leftWidth = 500;
      const rightX = leftX + leftWidth + 32;
      const rightWidth = canvas.width - rightX - 90;
      context.fillStyle = "rgba(9,29,69,0.84)";
      context.font = '800 20px "Trebuchet MS", Arial, sans-serif';
      context.fillText("FRENTE DE LOJA", leftX, contentY - 12);
      context.fillText("AÇÕES", rightX, contentY - 12);
      drawPhotoGrid(context, frontImages, leftX, contentY, leftWidth, contentHeight);
      drawPhotoGrid(context, actionImages, rightX, contentY, rightWidth, contentHeight);
      commitPage();
    }
  }

  endingImages.forEach((image) => drawFixedPage(image));
  pdf.save(safePdfFilename(book.nome));
}

function BookForm({ book, token, onClose, onSaved }) {
  const isEditing = Boolean(book?.id);
  const [nome, setNome] = useState(book?.nome || "");
  const [codigoFornecedor, setCodigoFornecedor] = useState(book?.codigoFornecedor || "");
  const [mesAno, setMesAno] = useState(book?.dataPeriodo ? String(book.dataPeriodo).slice(0, 7) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiJson(isEditing ? `/modules/promotores/books/${book.id}` : "/modules/promotores/books", {
        token,
        method: isEditing ? "PUT" : "POST",
        data: { nome, codigoFornecedor: Number(codigoFornecedor), mesAno }
      });
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
            <label>Fornecedor<select required value={codigoFornecedor} onChange={(event) => setCodigoFornecedor(event.target.value)}><option value="">Selecione o fornecedor</option>{SUPPLIERS.map((supplier) => <option value={supplier.code} key={supplier.code}>{supplier.name}</option>)}</select></label>
          </div>
          <div className="form-two">
            <label>Período<input required type="month" value={mesAno} onChange={(event) => setMesAno(event.target.value)} /></label>
            <div className="supplier-cover-preview"><span>Capa fixa do fornecedor</span>{codigoFornecedor ? <img src={supplierFor(codigoFornecedor)?.covers?.[0]} alt={`Capa de ${supplierFor(codigoFornecedor)?.name || "fornecedor"}`} /> : <strong>Selecione um fornecedor para visualizar.</strong>}</div>
          </div>
          <p className="muted small">A capa, as páginas finais e o padrão de exportação são definidos automaticamente pelo fornecedor.</p>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions"><button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Salvar book"}</button><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function SubmissionForm({ book, token, autoApprove, onClose, onSaved }) {
  const supplier = supplierFor(book.codigoFornecedor);
  const [codigoCliente, setCodigoCliente] = useState("");
  const [customer, setCustomer] = useState(null);
  const [customerLookup, setCustomerLookup] = useState({ loading: false, message: "" });
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const code = Number(codigoCliente);
    setCustomer(null);
    if (!Number.isInteger(code) || code <= 0) {
      setCustomerLookup({ loading: false, message: "" });
      return undefined;
    }
    let active = true;
    setCustomerLookup({ loading: true, message: "Consultando cliente no Winthor..." });
    const timeout = window.setTimeout(async () => {
      try {
        const payload = await apiJson(`/modules/promotores/books/clientes/${code}`, { token });
        if (!active) return;
        setCustomer(payload.cliente);
        setCustomerLookup({ loading: false, message: "" });
      } catch (requestError) {
        if (!active) return;
        setCustomerLookup({ loading: false, message: requestError.message });
      }
    }, 450);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [codigoCliente, token]);

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
    if (!customer) { setError(customerLookup.message || "Aguarde a confirmação do cliente no Winthor."); return; }
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
        <div className="modal-header"><div><div className="eyebrow">Enviar para {book.nome}</div><h2>Novo registro</h2><p className="muted">Seu nome de exibição será usado automaticamente como promotor. {autoApprove ? "O registro será aceito automaticamente." : "O registro seguirá para aprovação."}</p></div><button type="button" className="icon-btn" onClick={onClose}>x</button></div>
        <form className="form-stack" onSubmit={submit}>
          <div className="customer-code-row"><label>Código do cliente<input required type="number" min="1" step="1" value={codigoCliente} onChange={(event) => setCodigoCliente(event.target.value)} /></label><div className={`customer-lookup ${customer ? "customer-found" : ""}`} aria-live="polite">{customer ? <><strong>{customer.fantasia || customer.nome}</strong><span>{customer.cidade || "Cidade não informada"}</span></> : <span>{customerLookup.message || "Digite o código para consultar nome fantasia e cidade."}</span>}</div></div>
          <div className={`photo-upload-grid ${supplier?.actionOnly ? "single-upload" : ""}`}>
            {!supplier?.actionOnly ? <label className="file-drop"><strong>Fotos de Frente de Loja</strong><input type="file" multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); addPhotos("FRENTE_LOJA", files); event.currentTarget.value = ""; }} /><span>Adicionar fotos</span></label> : null}
            <label className="file-drop"><strong>Fotos de Ação</strong><input type="file" multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg" onClick={(event) => { event.currentTarget.value = ""; }} onChange={(event) => { const files = Array.from(event.currentTarget.files || []); addPhotos("ACAO", files); event.currentTarget.value = ""; }} /><span>Adicionar fotos</span></label>
          </div>
          {photos.length ? <div className="new-photo-list">{photos.map((photo) => <div className="mini-row" key={photo.key}><span>{photo.file.name}</span><strong>{photoTypeLabel(photo.type)}</strong><button type="button" className="danger-btn compact-btn" onClick={() => setPhotos((current) => current.filter((item) => item.key !== photo.key))}>Remover</button></div>)}</div> : null}
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions"><button className="primary-btn" type="submit" disabled={saving || customerLookup.loading || !customer}>{saving ? "Enviando..." : autoApprove ? "Adicionar ao book" : "Enviar para aprovação"}</button><button className="secondary-btn" type="button" onClick={onClose}>Cancelar</button></div>
        </form>
      </section>
    </div>
  );
}

function SubmissionReviewCard({ submission, busy, onReview }) {
  const allPhotoIds = useMemo(() => submission.anexos?.map((photo) => photo.id) || [], [submission.anexos]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(() => new Set(allPhotoIds));
  function togglePhoto(photoId) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
  }
  return (
    <section className="book-record-card submission-card">
      <div className="section-header"><div><div className="eyebrow">Envio #{submission.id}</div><h3>{submission.clienteNome} · {submission.clienteCidade}</h3><p className="muted small">Promotor: {submission.promotorNome} · Código {submission.codigoCliente}</p></div><div className="inline-actions"><button type="button" className="primary-btn compact-btn" disabled={busy || selectedPhotoIds.size === 0} onClick={() => onReview(submission, "ACCEPTED", [...selectedPhotoIds])}>Aceitar {selectedPhotoIds.size} foto(s)</button><button type="button" className="danger-btn compact-btn" disabled={busy} onClick={() => onReview(submission, "REJECTED", [])}>Recusar</button></div></div>
      <div className="photo-selection-toolbar"><span>Selecione as fotos que entrarão no book.</span><div className="inline-actions"><button type="button" className="text-btn" onClick={() => setSelectedPhotoIds(new Set(allPhotoIds))}>Selecionar todas</button><button type="button" className="text-btn" onClick={() => setSelectedPhotoIds(new Set())}>Limpar</button></div></div>
      <div className="book-photo-grid">{submission.anexos?.map((photo) => { const selected = selectedPhotoIds.has(photo.id); return <button type="button" className={`book-photo selectable-photo ${selected ? "selected" : ""}`} onClick={() => togglePhoto(photo.id)} key={photo.id}><span className="photo-check">{selected ? "✓" : ""}</span><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)} · {selected ? "Selecionada" : "Não selecionada"}</figcaption></button>; })}</div>
    </section>
  );
}

function BookDetails({ book, role, busy, error, onClose, onEdit, onDelete, onSubmitRecord, onReviewSubmission, onChangeStatus, onMoveRecord, onExport }) {
  const supplier = supplierFor(book.codigoFornecedor);
  const coverUrl = bookCoverUrl(book);
  const canManage = MANAGER_ROLES.has(role);
  const canDelete = BOOK_DELETER_ROLES.has(role);
  const isPromoter = role === "PROMOTER";
  const pendingSubmissions = (book.envios || []).filter((item) => item.status === "PENDING");
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card modal-card-wide book-workflow-modal" role="dialog" aria-modal="true">
        <div className="modal-header"><div><div className="eyebrow">Book #{book.id}</div><h2>{book.nome}</h2><p className="muted">{supplier?.name || `Fornecedor ${book.codigoFornecedor}`} · {book.periodo}</p></div><div className="inline-actions"><span className={`status-pill status-${book.status?.toLowerCase()}`}>{statusLabel(book.status)}</span><button type="button" className="icon-btn" onClick={onClose}>x</button></div></div>
        {error ? <p className="error-text">{error}</p> : null}
        {coverUrl ? <img className="book-detail-cover" src={coverUrl} alt={`Capa de ${supplier?.name || book.nome}`} /> : null}

        {canManage && pendingSubmissions.length ? <section className="workflow-section"><div className="section-header"><div><h3>Registros aguardando aprovação</h3><p className="muted small">Confira os dados e marque somente as fotos que entrarão no book.</p></div><span className="status-pill status-pending">{pendingSubmissions.length} pendente(s)</span></div><div className="book-record-list">{pendingSubmissions.map((submission) => <SubmissionReviewCard submission={submission} busy={busy} onReview={onReviewSubmission} key={submission.id} />)}</div></section> : null}

        <section className="workflow-section"><div className="book-record-list">{book.registros?.length ? book.registros.map((record, index) => <section className="book-record-card" key={record.id}><div className="section-header"><div><h3>{index + 1}. {record.clienteNome} · {record.clienteCidade}</h3><p className="muted small">Promotor: {record.promotor} · Código {record.codigoCliente}</p></div>{canManage && book.registros.length > 1 ? <div className="order-controls"><button type="button" className="secondary-btn compact-btn" disabled={busy || index === 0} onClick={() => onMoveRecord(index, -1)}>↑</button><button type="button" className="secondary-btn compact-btn" disabled={busy || index === book.registros.length - 1} onClick={() => onMoveRecord(index, 1)}>↓</button></div> : null}</div><div className="book-photo-grid">{record.anexos?.map((photo) => <a className="book-photo" href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt={photo.nomeOriginal} /><figcaption>{photoTypeLabel(photo.tipo)}</figcaption></a>)}</div></section>) : <div className="empty-state">Nenhum registro aceito ainda.</div>}</div></section>

        {isPromoter && book.envios?.length ? <section className="workflow-section"><h3>Meus envios</h3><div className="submission-history">{book.envios.map((submission) => <div className="mini-row" key={submission.id}><span>Cliente {submission.codigoCliente}</span><strong>{submissionStatusLabel(submission.status)}</strong>{submission.motivoRevisao ? <small>{submission.motivoRevisao}</small> : null}</div>)}</div></section> : null}

        <div className="modal-actions book-action-bar">
          {isPromoter && book.status === "ACTIVE" ? <button type="button" className="primary-btn" onClick={onSubmitRecord}>+ Enviar registro</button> : null}
          {canManage && book.status === "ACTIVE" ? <><button type="button" className="primary-btn" onClick={onSubmitRecord}>+ Adicionar registro</button><button type="button" className="secondary-btn" onClick={onEdit}>Editar dados</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => onChangeStatus("CLOSED")}>Encerrar book</button></> : null}
          {canManage && book.status !== "ACTIVE" ? <><button type="button" className="secondary-btn" disabled={busy} onClick={() => onChangeStatus("ACTIVE")}>Reabrir book</button><button type="button" className="secondary-btn" disabled={busy} onClick={onExport}>{busy ? "Gerando PDF..." : "Exportar PDF"}</button></> : null}
          {canDelete ? <button type="button" className="danger-btn" disabled={busy} onClick={onDelete}>Excluir book</button> : null}
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

  async function reviewSubmission(submission, decisao, anexoIds = []) {
    const motivo = decisao === "REJECTED" ? window.prompt("Motivo da recusa (opcional):", "") : "";
    if (decisao === "REJECTED" && motivo === null) return;
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/envios/${submission.id}/revisao`, { method: "PATCH", token, data: { decisao, motivo, anexoIds } }); await refreshSelected(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function changeStatus(status) {
    const confirmation = status === "CLOSED" ? "Encerrar este book e impedir novos envios?" : "Reabrir este book para novos envios?";
    if (!window.confirm(confirmation)) return;
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/status`, { method: "PATCH", token, data: { status } }); await refreshSelected(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function moveRecord(index, direction) {
    const reordered = [...selected.registros];
    const [record] = reordered.splice(index, 1);
    reordered.splice(index + direction, 0, record);
    setBusy(true); setDetailError("");
    try { await apiJson(`/modules/promotores/books/${selected.id}/registros/ordem`, { method: "PATCH", token, data: { registroIds: reordered.map((item) => item.id) } }); setSelected((current) => ({ ...current, registros: reordered })); await load(); } catch (requestError) { setDetailError(requestError.message); } finally { setBusy(false); }
  }

  async function handleExport() {
    setBusy(true);
    setDetailError("");
    try { await exportBookPdf(selected); } catch (exportError) { setDetailError(exportError.message); } finally { setBusy(false); }
  }

  return (
    <div className="page-stack">
      <section className="table-card"><div className="toolbar"><div><h2>{user?.role === "PROMOTER" ? "Books ativos" : "Últimos books"}</h2><p className="muted small">{pageInfo.total} book(s) disponível(is).</p></div><div className="inline-actions"><input placeholder="Nome, fornecedor ou período" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(1); setAppliedQuery(query); } }} /><button className="secondary-btn" onClick={() => { setPage(1); setAppliedQuery(query); }}>Buscar</button></div></div>
        {error ? <p className="error-text">{error}</p> : null}
        {loading ? <div className="empty-state">Carregando books...</div> : books.length ? <div className="book-grid">{books.map((book) => { const supplier = supplierFor(book.codigoFornecedor); const coverUrl = bookCoverUrl(book); return <button type="button" className="book-card" key={book.id} onClick={() => openBook(book.id)}>{coverUrl ? <img src={coverUrl} alt="" /> : <div className="book-card-placeholder">Sem capa</div>}<span><span className={`status-pill status-${book.status?.toLowerCase()}`}>{statusLabel(book.status)}</span><strong>{book.nome}</strong><small>{supplier?.name || `Fornecedor ${book.codigoFornecedor}`} · {book.periodo}</small>{user?.role === "PROMOTER" ? <small>Seus envios: {book._count?.envios || 0}</small> : <small>{book._count?.registros || 0} registro(s) · {book._count?.anexos || 0} foto(s)</small>}</span></button>; })}</div> : <div className="empty-state">Nenhum book encontrado.</div>}
        <div className="pagination-bar"><button className="secondary-btn compact-btn" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button><span>Página {page} de {pageInfo.totalPages}</span><button className="secondary-btn compact-btn" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>Próxima</button></div>
      </section>
      {selected ? <BookDetails book={selected} role={user?.role} busy={busy} error={detailError} onClose={() => { setSelected(null); setDetailError(""); }} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => removeBook(selected)} onSubmitRecord={() => setSubmittingRecord(true)} onReviewSubmission={reviewSubmission} onChangeStatus={changeStatus} onMoveRecord={moveRecord} onExport={handleExport} /> : null}
      {editing !== undefined ? <BookForm book={editing} token={token} onClose={() => setEditing(undefined)} onSaved={async (book) => { setEditing(undefined); await load(); await openBook(book.id); }} /> : null}
      {submittingRecord && selected ? <SubmissionForm book={selected} token={token} autoApprove={canManage} onClose={() => setSubmittingRecord(false)} onSaved={async () => { setSubmittingRecord(false); await refreshSelected(); }} /> : null}
    </div>
  );
});

export default BooksPage;
