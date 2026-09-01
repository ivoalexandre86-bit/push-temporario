import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Loading } from './components/Loading';

import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import ActionsList from './pages/ActionsList';
import ActionDetail from './pages/ActionDetail';
import ProjectsList from './pages/ProjectsList';
import ProjectWorkspace from './pages/ProjectWorkspace';
import Hours from './pages/Hours';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import AdminUsers from './pages/AdminUsers';
import NotFound from './pages/NotFound';
import Forbidden from './pages/Forbidden';

function ProtectedRoute({ children, permission }) {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Verificando sessão..." />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (permission && !hasPermission(permission)) return <Forbidden />;
  return children;
}

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return <Loading label="Carregando aplicação..." />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/esqueci-senha" element={<ForgotPassword />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/acoes" element={<ActionsList />} />
        <Route path="/acoes/:id" element={<ActionDetail />} />
        <Route path="/projetos" element={<ProjectsList />} />
        <Route path="/projetos/:id" element={<ProjectWorkspace />} />
        <Route path="/horas" element={<Hours />} />
        <Route path="/relatorios" element={<Reports />} />
        <Route path="/auditoria" element={<ProtectedRoute permission="audit.view"><Audit /></ProtectedRoute>} />
        <Route path="/admin/usuarios" element={<ProtectedRoute permission="users.manage"><AdminUsers /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
