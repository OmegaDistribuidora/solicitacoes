import { useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import BooksPage from "./BooksPage";
import RotaPromotorPage from "./RotaPromotorPage";

export default function PromotoresPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const booksOnly = user?.role === "PROMOTER" || user?.role === "MERCH_COORDINATOR";
  const tab = booksOnly || searchParams.get("aba") === "books" ? "books" : "rota";
  const routePageRef = useRef(null);
  const booksPageRef = useRef(null);
  const canCreateBook = ["ADMIN", "ANALYST", "MERCH_COORDINATOR"].includes(user?.role);

  return (
    <div className="page-stack">
      <section className="page-card promoter-module-header">
        <div><div className="eyebrow">Merchandising</div><h1>Promotores</h1><p className="muted">{booksOnly ? (user?.role === "PROMOTER" ? "Envie seus registros para os books ativos." : "Crie, acompanhe e finalize os books de execução nas lojas.") : "Gerencie as rotas dos promotores e os books de execução nas lojas."}</p></div>
        <div className="promoter-header-actions">
          <div className="segmented promoter-tabs" role="tablist">
            {!booksOnly ? <button type="button" className={tab === "rota" ? "is-active" : ""} onClick={() => setSearchParams({ aba: "rota" })}>Rota</button> : null}
            <button type="button" className={tab === "books" ? "is-active" : ""} onClick={() => setSearchParams({ aba: "books" })}>Books</button>
          </div>
          {tab === "rota" ? <button type="button" className="primary-btn promoter-new-route" onClick={() => routePageRef.current?.openCreate()}>Nova rota</button> : null}
          {tab === "books" && canCreateBook ? <button type="button" className="primary-btn promoter-new-route" onClick={() => booksPageRef.current?.openCreate()}>Novo book</button> : null}
        </div>
      </section>
      {tab === "books" ? <BooksPage ref={booksPageRef} /> : <RotaPromotorPage ref={routePageRef} />}
    </div>
  );
}
