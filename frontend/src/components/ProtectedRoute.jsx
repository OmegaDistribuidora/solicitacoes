import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="screen-center">Carregando...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}
