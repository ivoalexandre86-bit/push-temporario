import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-bold text-gray-900 mb-4 text-center">Redefinir senha</h1>
        <form onSubmit={handleSubmit} className="bg-white border border-[var(--color-border)] rounded-xl p-6 shadow-sm space-y-4">
          <p className="text-sm text-gray-600">Informe seu e-mail cadastrado. Enviaremos um link para redefinir sua senha, válido por 1 hora.</p>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
          </div>
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
          {message && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2" role="status">{message}</p>}
          <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-md py-2.5 text-sm">
            {loading ? 'Enviando...' : 'Enviar link de redefinição'}
          </button>
          <div className="text-center">
            <Link to="/login" className="text-sm text-blue-600 hover:underline">Voltar ao login</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
