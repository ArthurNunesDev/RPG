import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

function LoadingScreen() {
  return <main className="auth-screen"><div className="auth-loading"><span className="loading-mark">✦</span><p>Preparando seu reino...</p></div></main>;
}

export function RequireAuth() {
  const { configured, loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!configured || !user) return <Navigate to="/auth" replace state={{ from: location }} />;
  return <Outlet />;
}

export function RequireRole() {
  const { loading, user, profile } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!profile?.preferred_role) return <Navigate to="/choose-role" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const { loading, user, profile } = useAuth();
  const location = useLocation();
  const isPasswordRecovery = location.hash.includes("type=recovery");
  if (loading) return <LoadingScreen />;
  if (user && !isPasswordRecovery) return <Navigate to={profile?.preferred_role ? "/" : "/choose-role"} replace />;
  return <Outlet />;
}
