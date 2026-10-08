import { useSearchParams } from "react-router-dom";
import BooksPage from "./BooksPage";
import RotaPromotorPage from "./RotaPromotorPage";

export default function PromotoresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("aba") === "books" ? "books" : "rota";

  return (
    <div className="page-stack">
      <section className="page-card promoter-module-header">
        <div><div className="eyebrow">Merchandising</div><h1>Promotores</h1><p className="muted">Gerencie as rotas dos promotores e os books de execução nas lojas.</p></div>
        <div className="segmented promoter-tabs" role="tablist">
          <button type="button" className={tab === "rota" ? "is-active" : ""} onClick={() => setSearchParams({ aba: "rota" })}>Rota</button>
          <button type="button" className={tab === "books" ? "is-active" : ""} onClick={() => setSearchParams({ aba: "books" })}>Books</button>
        </div>
      </section>
      {tab === "books" ? <BooksPage /> : <RotaPromotorPage />}
    </div>
  );
}
