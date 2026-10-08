import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AuditPage from "./pages/AuditPage";
import RoteirizacaoPage from "./pages/RoteirizacaoPage";
import PromotoresPage from "./pages/PromotoresPage";
import { useAuth } from "./components/AuthProvider";

function HomeRedirectPage() {
  const { user } = useAuth();
  if (user?.role === "ADMIN") return <Navigate to="/dashboard" replace />;
  const modules = user?.modules?.map((item) => item.module) || [];
  return <Navigate to={modules.includes("ROTEIRIZACAO") ? "/modules/roteirizacao" : "/modules/promotores"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomeRedirectPage />} />
        <Route
          path="dashboard"
          element={
            <AdminRoute>
              <DashboardPage />
            </AdminRoute>
          }
        />
        <Route path="modules/roteirizacao" element={<RoteirizacaoPage />} />
        <Route path="modules/promotores" element={<PromotoresPage />} />
        <Route path="modules/rota-promotor" element={<Navigate to="/modules/promotores?aba=rota" replace />} />
        <Route
          path="admin/users"
          element={
            <AdminRoute>
              <AdminUsersPage />
            </AdminRoute>
          }
        />
        <Route
          path="admin/audit"
          element={
            <AdminRoute>
              <AuditPage />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
