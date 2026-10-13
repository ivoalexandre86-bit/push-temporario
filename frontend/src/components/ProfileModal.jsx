import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ROLE_LABELS } from '../utils/constants';

export default function ProfileModal({ open, onClose, onChangePassword }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(user));
    setError('');
  }, [open]);

  if (!open) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const emailChanged = form.email.trim().toLowerCase() !== (user?.email || '').toLowerCase();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.name.trim().length < 2) {
      setError('Informe o nome (ao menos 2 caracteres).');
      return;
    }
    if (emailChanged && !form.currentPassword) {
      setError('Para alterar o e-mail, informe sua senha atual.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch('/me', {
        name: form.name.trim(),
        email: form.email.trim(),
        ...(emailChanged ? { currentPassword: form.currentPassword } : {}),
      });
      await refresh();
      toast.success(res.message);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Meu perfil</h2>
        <p className="text-sm text-gray-500 mb-4">Perfil de acesso: {ROLE_LABELS[user?.role] || user?.roleName || user?.role}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <Field label="Nome *" htmlFor="profile-name">
            <input id="profile-name" required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => set({ name: e.target.value })} className="input" />
          </Field>

          <Field label="E-mail *" htmlFor="profile-email">
            <input id="profile-email" type="email" required autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} className="input" />
            <p className="text-xs text-gray-500 mt-1">É o e-mail usado para entrar e para receber o link de redefinição de senha.</p>
          </Field>

          {emailChanged && (
            <Field label="Senha atual (para confirmar a troca de e-mail) *" htmlFor="profile-current-password">
              <input id="profile-current-password" type="password" required autoComplete="current-password" value={form.currentPassword} onChange={(e) => set({ currentPassword: e.target.value })} className="input" />
            </Field>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button type="button" onClick={onChangePassword} className="text-sm text-blue-600 hover:underline">
              Alterar minha senha
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function emptyForm(user) {
  return { name: user?.name || '', email: user?.email || '', currentPassword: '' };
}
