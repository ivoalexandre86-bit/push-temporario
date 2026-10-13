import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = (searchParams.get('token') || '').trim();
  // 'checking' | 'valid' | 'invalid'
  const [linkState, setLinkState] = useState(token ? 'checking' : 'invalid');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then((res) => { if (!cancelled) setLinkState(res.valid ? 'valid' : 'invalid'); })
      // On a network hiccup let the user try anyway; the POST validates again.
      .catch(() => { if (!cancelled) setLinkState('valid'); });
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('A nova senha deve ter ao menos 8 caracteres.'); return; }
    if (newPassword !== confirm) { setError('A confirmação não corresponde à nova senha.'); return; }
    setLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { token, newPassword, confirmPassword: confirm });
      navigate('/login', { replace: true, state: { notice: res.message } });
    } catch (err) {
      if (err.code === 'INVALID_TOKEN') setLinkState('invalid');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-bold text-gray-900 mb-4 text-center">Definir nova senha</h1>
        <div className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm space-y-4">
          {linkState === 'checking' && <p className="text-sm text-gray-600" role="status">Verificando o link...</p>}

          {linkState === 'invalid' && (
            <>
              <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                Este link de redefinição é inválido, já foi usado ou expirou (os links valem por 1 hora).
              </p>
              <Link to="/esqueci-senha" className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md py-2.5 text-sm">
                Solicitar um novo link
              </Link>
            </>
          )}

          {linkState === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
                <input id="newPassword" type="password" required minLength={8} maxLength={72} autoComplete="new-password" autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                <p className="text-xs text-gray-500 mt-1">Mínimo de 8 caracteres.</p>
              </div>
              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
                <input id="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-md py-2.5 text-sm">
                {loading ? 'Salvando...' : 'Redefinir senha'}
              </button>
            </form>
          )}

          <div className="text-center">
            <Link to="/login" className="text-sm text-blue-600 hover:underline">Voltar ao login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
