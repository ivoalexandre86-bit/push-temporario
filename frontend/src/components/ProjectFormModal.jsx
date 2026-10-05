import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { PROJECT_STATUSES, PROJECT_STATUS_META } from '../utils/constants';

/**
 * Create (no `project`) or edit (`project` given) a project. The project
 * manager (managerUserId -> projects.manager_user_id) is required in both
 * cases; eligible users come from /projects/manager-options.
 */
export default function ProjectFormModal({ open, onClose, onCreated, onSaved, project }) {
  const toast = useToast();
  const isEdit = Boolean(project);
  const [form, setForm] = useState(() => toForm(project));
  const [managers, setManagers] = useState([]);
  const [managersError, setManagersError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm(toForm(project));
    setError('');
    setFieldErrors({});
    setManagersError('');
    api.get('/projects/manager-options')
      .then((d) => setManagers(d.items || []))
      .catch(() => { setManagers([]); setManagersError('Não foi possível carregar a lista de gerentes.'); });
  }, [open, project]);

  if (!open) return null;

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setFieldErrors((errs) => ({ ...errs, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };

  // Keep showing the current manager even if they are no longer eligible
  // (inactive/role changed), so the select never silently changes value.
  const currentManagerMissing = isEdit && project.manager_user_id
    && !managers.some((m) => m.id === project.manager_user_id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const errs = {};
    if (!form.name.trim()) errs.name = 'Informe o nome do projeto.';
    if (!form.managerUserId) errs.managerUserId = 'Selecione o gerente do projeto.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      setError('Corrija os campos destacados.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      managerUserId: Number(form.managerUserId),
      status: form.status,
    };
    try {
      if (isEdit) {
        await api.patch(`/projects/${project.id}`, payload);
        toast.success(`Projeto "${payload.name}" atualizado.`);
        onSaved?.();
      } else {
        const created = await api.post('/projects', payload);
        toast.success(`Projeto "${payload.name}" criado com sucesso.`);
        onCreated?.(created);
      }
      onClose();
    } catch (err) {
      setError(err.message);
      const details = Array.isArray(err.details) ? err.details : [];
      setFieldErrors(Object.fromEntries(details.filter((d) => d.path).map((d) => [d.path, d.message])));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{isEdit ? 'Editar projeto' : 'Novo projeto'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          <Field label="Nome do projeto *" htmlFor="project-name" error={fieldErrors.name}>
            <input id="project-name" required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!fieldErrors.name} className="input" />
          </Field>

          <Field label="Descrição" htmlFor="project-description">
            <textarea id="project-description" rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} className="input" />
          </Field>

          <Field label="Gerente do projeto *" htmlFor="project-manager" error={fieldErrors.managerUserId || managersError}>
            <select
              id="project-manager"
              required
              value={form.managerUserId}
              onChange={(e) => set({ managerUserId: e.target.value })}
              aria-invalid={!!fieldErrors.managerUserId}
              className="input"
            >
              <option value="">Selecione...</option>
              {currentManagerMissing && (
                <option value={project.manager_user_id}>{project.manager_name || `Usuário ${project.manager_user_id}`} (inativo ou sem papel de gerente)</option>
              )}
              {managers.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role_name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Somente usuários ativos com papel de Administrador ou Gerente de Projeto. Um Gerente de Projeto selecionado passa a ter acesso a este projeto.</p>
          </Field>

          <Field label="Status" htmlFor="project-status">
            <select id="project-status" value={form.status} onChange={(e) => set({ status: e.target.value })} className="input">
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_META[s].label}</option>)}
            </select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Criar projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, error, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}

function toForm(project) {
  if (!project) return { name: '', description: '', managerUserId: '', status: 'ANDAMENTO' };
  return {
    name: project.name || '',
    description: project.description || '',
    managerUserId: project.manager_user_id ? String(project.manager_user_id) : '',
    status: project.status || 'ANDAMENTO',
  };
}
