import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Não foi possível entrar. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">Sistema de Gestão de Projetos</h1>
          <p className="text-sm text-gray-500 mt-1">Entre com sua conta para continuar</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 border border-red-200">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              id="email" type="email" autoComplete="username" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              id="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-md py-2.5 text-sm transition-colors"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
          <div className="text-center">
            <Link to="/esqueci-senha" className="text-sm text-blue-600 hover:underline">Esqueci minha senha</Link>
          </div>
        </form>
        <div className="mt-4 bg-gray-100 rounded-lg p-3 text-xs text-gray-500 space-y-0.5">
          <p className="font-semibold text-gray-600">Contas de demonstração (senha: Mudar@123):</p>
          <p>admin@projetos.local · gerente@projetos.local · colaborador@projetos.local</p>
          <p>visualizador@projetos.local · auditor@projetos.local</p>
        </div>
      </div>
    </div>
  );
}
