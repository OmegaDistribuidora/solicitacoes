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
    const items = [{ to: "/modules/roteirizacao", label: "Roteirizacao" }];
    if (user?.role === "ADMIN") {
      items.unshift({ to: "/dashboard", label: "Inicio" });
      items.push({ to: "/admin/users", label: "Usuarios" }, { to: "/admin/audit", label: "Auditoria" });
    }
    return items;
  }, [user?.role]);

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
            <span>
              <strong>Solicitacoes Trade</strong>
              <small>Omega Distribuidora</small>
            </span>
          </NavLink>
        </div>

        <nav className="nav-stack">
          {navigationItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link" end={item.to === "/dashboard"}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div>
            <strong>{user?.displayName}</strong>
            <div className="muted small">{profileLabel}</div>
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
