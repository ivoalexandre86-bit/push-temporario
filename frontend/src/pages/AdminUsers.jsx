import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useCatalogs } from '../hooks/useCatalogs';
import { useToast } from '../context/ToastContext';
import { Loading, ErrorState } from '../components/Loading';
import { ROLE_LABELS } from '../utils/constants';
import { formatDateTime } from '../utils/format';

const ROLES = ['ADMIN', 'PROJECT_MANAGER', 'CONTRIBUTOR', 'VIEWER', 'AUDITOR'];

export default function AdminUsers() {
  const { projects } = useCatalogs();
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'VIEWER', projectScope: [] });
  const [tempPasswords, setTempPasswords] = useState({});

  const load = () => {
    api.get('/users').then((d) => setUsers(d.items)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const createUser = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/users', newUser);
      toast.success('Usuário criado com sucesso.');
      if (res.temporaryPassword) setTempPasswords((p) => ({ ...p, [res.id]: res.temporaryPassword }));
      setShowNew(false);
      setNewUser({ name: '', email: '', role: 'VIEWER', projectScope: [] });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const updateUser = async (id, patch) => {
    try {
      await api.patch(`/users/${id}`, patch);
      toast.success('Usuário atualizado.');
      load();
    } catch (err) { toast.error(err.message); }
  };

  const resetPassword = async (id) => {
    try {
      const res = await api.post(`/users/${id}/reset-password`);
      setTempPasswords((p) => ({ ...p, [id]: res.temporaryPassword }));
      toast.success('Senha temporária gerada.');
    } catch (err) { toast.error(err.message); }
  };

  if (error) return <ErrorState message={error} />;
  if (!users) return <Loading />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Usuários e Permissões</h1>
        <button onClick={() => setShowNew((s) => !s)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          {showNew ? 'Cancelar' : '+ Novo usuário'}
        </button>
      </div>

      {showNew && (
        <form onSubmit={createUser} className="bg-white border border-[var(--color-border)] rounded-xl p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
            <input required value={newUser.name} onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail</label>
            <input type="email" required value={newUser.email} onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Papel</label>
            <select value={newUser.role} onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))} className="input">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <button type="submit" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 h-9">Criar</button>
        </form>
      )}

      <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Nome</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">E-mail</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Papel</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Projetos (escopo)</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Último login</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50">
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    <select value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })} className="input !w-auto py-1">
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      multiple
                      value={u.projectScope.map(String)}
                      onChange={(e) => updateUser(u.id, { projectScope: [...e.target.selectedOptions].map((o) => Number(o.value)) })}
                      className="input !w-40 h-16 text-xs"
                    >
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={!!u.active} onChange={(e) => updateUser(u.id, { active: e.target.checked })} className="rounded border-gray-300 text-blue-600" />
                      {u.active ? 'Ativo' : 'Inativo'}
                    </label>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{u.last_login_at ? formatDateTime(u.last_login_at) : 'nunca'}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => resetPassword(u.id)} className="text-xs text-blue-600 hover:underline">Redefinir senha</button>
                    {tempPasswords[u.id] && (
                      <p className="text-[10px] text-amber-700 mt-1">Senha temp.: <code>{tempPasswords[u.id]}</code></p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
