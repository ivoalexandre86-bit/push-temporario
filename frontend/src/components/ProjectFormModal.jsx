import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

export default function ProjectFormModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm());
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setError('');
    api.get('/users').then((d) => setUsers(d.items || [])).catch(() => setUsers([]));
  }, [open]);

  if (!open) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('Informe o nome do projeto.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post('/projects', {
        name: form.name.trim(),
        description: form.description || null,
        managerUserId: form.managerUserId ? Number(form.managerUserId) : null,
      });
      toast.success(`Projeto "${form.name.trim()}" criado com sucesso.`);
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Novo projeto</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <Field label="Nome do projeto *">
            <input required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className="input" />
          </Field>

          <Field label="Descrição">
            <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} className="input" />
          </Field>

          {users.length > 0 && (
            <Field label="Gerente de projeto">
              <select value={form.managerUserId} onChange={(e) => set({ managerUserId: e.target.value })} className="input">
                <option value="">Não definido</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Salvando...' : 'Criar projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function emptyForm() {
  return { name: '', description: '', managerUserId: '' };
}
