import { useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import omegaLogo from "../assets/logo.png";

function roleLabel(role) {
  if (role === "ADMIN") return "Administrador";
  if (role === "ANALYST") return "Analista";
  return "Supervisor";
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navigationItems = useMemo(() => {
    const modules = user?.modules?.map((item) => item.module) || [];
    const hasAllModules = user?.role === "ADMIN" || user?.role === "ANALYST";
    const items = [];
    if (hasAllModules || modules.includes("ROTEIRIZACAO")) {
      items.push({ to: "/modules/roteirizacao", label: "Roteirizacao", code: "RT" });
    }
    if (hasAllModules || modules.includes("ROTA_PROMOTOR")) {
      items.push({ to: "/modules/promotores", label: "Promotores", code: "PM" });
    }
    if (user?.role === "ADMIN") {
      items.unshift({ to: "/dashboard", label: "Inicio", code: "IN" });
      items.push(
        { to: "/admin/users", label: "Usuarios", code: "US" },
        { to: "/admin/audit", label: "Auditoria", code: "AU" }
      );
    }
    return items;
  }, [user?.role, user?.modules]);

  const routeCodes = user?.routeSupervisorCodes || [];
  const profileLabel =
    user?.role === "SUPERVISOR" && routeCodes.length
      ? `Supervisor ${routeCodes.join(", ")}`
      : roleLabel(user?.role);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <NavLink to="/" className="brand-link">
            <img src={omegaLogo} alt="Omega" className="brand-logo-image" />
            <span className="brand-copy">
              <small className="brand-kicker">Central Trade</small>
              <strong>Solicitacoes Trade</strong>
              <small>Omega Distribuidora</small>
            </span>
          </NavLink>
        </div>

        <nav className="nav-stack">
          {navigationItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link" end={item.to === "/dashboard"}>
              <span className="nav-code" aria-hidden="true">{item.code}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="profile-block">
            <span className="profile-monogram" aria-hidden="true">{user?.displayName?.trim()?.charAt(0)?.toUpperCase() || "O"}</span>
            <span>
            <strong>{user?.displayName}</strong>
            <div className="muted small">{profileLabel}</div>
            </span>
          </div>
          <button type="button" className="primary-btn ghost-btn" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
