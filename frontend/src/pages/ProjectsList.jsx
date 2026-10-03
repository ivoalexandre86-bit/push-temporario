import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import MultiSelect from '../components/MultiSelect';
import ProjectFormModal from '../components/ProjectFormModal';
import StatusChip from '../components/StatusChip';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  PERMISSIONS, PROJECT_STATUSES, PROJECT_STATUS_META, PROJECT_PRIORITIES, PROJECT_PRIORITY_META,
} from '../utils/constants';
import { formatDate, formatPercent } from '../utils/format';

const NONE = 'none';

const PCT_RANGES = [
  { value: '0-25', label: '0–25%', min: 0, max: 25 },
  { value: '25-50', label: '25–50%', min: 25, max: 50 },
  { value: '50-75', label: '50–75%', min: 50, max: 75 },
  { value: '75-100', label: '75–100%', min: 75, max: 100 },
];

// Filters kept in the query string (multi-value ones as comma-separated lists).
const LIST_KEYS = ['project', 'status', 'manager', 'priority', 'pct'];
const FLAG_KEYS = ['open', 'overdue', 'soon'];

const PRIORITY_RANK = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

const COLUMNS = [
  { key: 'name', label: 'Projeto', get: (p) => p.name.toLowerCase() },
  { key: 'status', label: 'Status do projeto', get: (p) => PROJECT_STATUS_META[p.status]?.label || p.status },
  { key: 'manager', label: 'Gerente', get: (p) => p.manager_name?.toLowerCase() ?? null },
  { key: 'priority', label: 'Prioridade', get: (p) => PRIORITY_RANK[p.priority] ?? null },
  { key: 'actions', label: 'Ações', get: (p) => p.action_count, numeric: true },
  { key: 'open', label: 'Em aberto', get: (p) => p.open_count, numeric: true },
  { key: 'overdue', label: 'Atrasadas', get: (p) => p.overdue_count, numeric: true },
  { key: 'pct', label: '% concluído', get: (p) => p.completion_pct, numeric: true },
  { key: 'nextDue', label: 'Próximo prazo', get: (p) => p.next_due_date },
  { key: 'notes', label: 'Observação', get: (p) => p.notes?.toLowerCase() || null },
];

function normalize(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function useProjectFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const f = { q: searchParams.get('q') || '', sort: searchParams.get('sort') || 'name', dir: searchParams.get('dir') === 'desc' ? 'desc' : 'asc' };
    for (const k of LIST_KEYS) f[k] = (searchParams.get(k) || '').split(',').filter(Boolean);
    for (const k of FLAG_KEYS) f[k] = searchParams.get(k) === '1';
    return f;
  }, [searchParams]);

  const setFilters = useCallback((patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        const str = Array.isArray(v) ? v.join(',') : v === true ? '1' : v === false ? '' : String(v ?? '');
        if (str) next.set(k, str);
        else next.delete(k);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const clearAll = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      for (const k of ['sort', 'dir']) if (prev.get(k)) next.set(k, prev.get(k));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const activeCount = LIST_KEYS.filter((k) => filters[k].length).length
    + FLAG_KEYS.filter((k) => filters[k]).length
    + (filters.q.trim() ? 1 : 0);

  return { filters, setFilters, clearAll, activeCount };
}

function applyFilters(projects, f) {
  const needle = normalize(f.q.trim());
  return projects.filter((p) => {
    if (f.project.length && !f.project.includes(String(p.id))) return false;
    if (f.status.length && !f.status.includes(p.status)) return false;
    if (f.manager.length && !f.manager.includes(p.manager_user_id ? String(p.manager_user_id) : NONE)) return false;
    if (f.priority.length && !f.priority.includes(p.priority || NONE)) return false;
    if (f.open && !(p.open_count > 0)) return false;
    if (f.overdue && !(p.overdue_count > 0)) return false;
    // due_soon_count = open actions due between today and today + 7 days (computed by the API)
    if (f.soon && !(p.due_soon_count > 0)) return false;
    if (f.pct.length) {
      const pct = Number(p.completion_pct) || 0;
      const inRange = PCT_RANGES.some((r) => f.pct.includes(r.value) && pct >= r.min && (r.max === 100 ? pct <= 100 : pct < r.max));
      if (!inRange) return false;
    }
    if (needle && !normalize(p.name).includes(needle) && !normalize(p.notes).includes(needle)) return false;
    return true;
  });
}

const isEmpty = (v) => v === null || v === undefined || v === '';

function sortProjects(projects, sortKey, dir) {
  const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
  const sign = dir === 'desc' ? -1 : 1;
  return [...projects].sort((a, b) => {
    const va = col.get(a);
    const vb = col.get(b);
    // Empty values always go last, regardless of direction.
    if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) - isEmpty(vb) || a.name.localeCompare(b.name, 'pt-BR');
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
    return cmp * sign || a.name.localeCompare(b.name, 'pt-BR');
  });
}

function PriorityCell({ project, canEdit, onSave }) {
  if (!canEdit) {
    const meta = PROJECT_PRIORITY_META[project.priority];
    return meta ? <span className={`font-medium ${meta.className}`}>{meta.label}</span> : <span className="text-gray-400">—</span>;
  }
  return (
    <select
      value={project.priority || ''}
      onChange={(e) => onSave(project, { priority: e.target.value || null })}
      aria-label={`Prioridade de ${project.name}`}
      className={`rounded-md border border-gray-300 bg-white px-2 py-1 text-sm ${PROJECT_PRIORITY_META[project.priority]?.className || 'text-gray-500'}`}
    >
      <option value="">—</option>
      {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{PROJECT_PRIORITY_META[p].label}</option>)}
    </select>
  );
}

function NotesCell({ project, canEdit, onSave }) {
  const [draft, setDraft] = useState(project.notes || '');
  const cancelRef = useRef(false);

  if (!canEdit) {
    return project.notes
      ? <span className="block max-w-[18rem] truncate" title={project.notes}>{project.notes}</span>
      : <span className="text-gray-400">—</span>;
  }

  const commit = () => {
    if (cancelRef.current) { cancelRef.current = false; return; }
    const value = draft.trim();
    if (value !== (project.notes || '')) onSave(project, { notes: value || null });
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelRef.current = true;
          setDraft(project.notes || '');
          e.currentTarget.blur();
        }
      }}
      maxLength={2000}
      placeholder="Adicionar observação"
      aria-label={`Observação de ${project.name}`}
      title={project.notes || ''}
      className="w-56 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
    />
  );
}

function ProgressCell({ pct }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-gray-200 overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-green-500" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-600 tabular-nums">{formatPercent(value)}</span>
    </div>
  );
}

export default function ProjectsList() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const { filters, setFilters, clearAll, activeCount } = useProjectFilters();
  const canEdit = hasPermission(PERMISSIONS.PROJECTS_MANAGE);

  const reload = () => api.get('/projects').then((d) => setProjects(d.items)).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  const saveField = async (project, patch) => {
    const previous = { priority: project.priority, notes: project.notes };
    setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, ...patch } : p)));
    try {
      await api.patch(`/projects/${project.id}`, patch);
    } catch (e) {
      setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, ...previous } : p)));
      toast.error(e.message || 'Não foi possível salvar a alteração.');
    }
  };

  const visible = useMemo(
    () => (projects ? sortProjects(applyFilters(projects, filters), filters.sort, filters.dir) : []),
    [projects, filters],
  );

  const managerOptions = useMemo(() => {
    const map = new Map();
    for (const p of projects || []) if (p.manager_user_id) map.set(String(p.manager_user_id), p.manager_name || `Usuário ${p.manager_user_id}`);
    return [
      { value: NONE, label: 'Sem gerente' },
      ...[...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([value, label]) => ({ value, label })),
    ];
  }, [projects]);

  if (error) return <ErrorState message={error} />;
  if (!projects) return <Loading />;

  const now = new Date();
  const today = localISODate(now);
  const soonLimit = localISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  const toggleSort = (key) => {
    if (filters.sort === key) setFilters({ dir: filters.dir === 'asc' ? 'desc' : 'asc' });
    else setFilters({ sort: key, dir: 'asc' });
  };

  const checkbox = (key, label) => (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
      <input
        type="checkbox"
        checked={filters[key]}
        onChange={(e) => setFilters({ [key]: e.target.checked })}
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Projetos</h1>
        {canEdit && (
          <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            + Novo projeto
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <EmptyState title="Nenhum projeto disponível" description="Você ainda não tem acesso a nenhum projeto." />
      ) : (
        <>
          <div className="bg-white border border-[var(--color-border)] rounded-xl p-3 md:p-4 mb-4">
            <div className="flex flex-wrap gap-3 items-end">
              <MultiSelect
                label="Projeto"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={filters.project}
                onChange={(v) => setFilters({ project: v })}
              />
              <MultiSelect
                label="Status do projeto"
                options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_META[s].label }))}
                value={filters.status}
                onChange={(v) => setFilters({ status: v })}
              />
              <MultiSelect
                label="Gerente"
                options={managerOptions}
                value={filters.manager}
                onChange={(v) => setFilters({ manager: v })}
              />
              <MultiSelect
                label="Prioridade"
                options={[{ value: NONE, label: 'Sem prioridade' }, ...PROJECT_PRIORITIES.map((p) => ({ value: p, label: PROJECT_PRIORITY_META[p].label }))]}
                value={filters.priority}
                onChange={(v) => setFilters({ priority: v })}
              />
              <MultiSelect
                label="% concluído"
                options={PCT_RANGES.map(({ value, label }) => ({ value, label }))}
                value={filters.pct}
                onChange={(v) => setFilters({ pct: v })}
              />
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="projects-q">Buscar</label>
                <input
                  id="projects-q"
                  type="search"
                  value={filters.q}
                  onChange={(e) => setFilters({ q: e.target.value })}
                  placeholder="Nome ou observação"
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3">
              {checkbox('open', 'Com ações em aberto')}
              {checkbox('overdue', 'Com ações atrasadas')}
              {checkbox('soon', 'Prazo nos próximos 7 dias')}
              <div className="ml-auto flex items-center gap-3 text-sm">
                <span className="text-gray-500">{visible.length} de {projects.length} projetos</span>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={activeCount === 0}
                  className="text-blue-600 hover:underline font-medium disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                >
                  Limpar filtros
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-x-auto scrollbar-thin">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <tr>
                  {COLUMNS.map((c) => {
                    const active = filters.sort === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={`px-3 py-2 whitespace-nowrap ${c.numeric && c.key !== 'pct' ? 'text-right' : ''}`}
                      >
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-gray-900">
                          {c.label}
                          <span aria-hidden="true" className={active ? 'text-gray-700' : 'text-gray-300'}>
                            {active ? (filters.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-500">
                      Nenhum projeto corresponde aos filtros.
                    </td>
                  </tr>
                )}
                {visible.map((p) => {
                  const overdueNext = p.next_due_date && p.next_due_date < today;
                  const soonNext = p.next_due_date && !overdueNext && p.next_due_date <= soonLimit;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Link to={`/projetos/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link>
                          {!p.active && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">Inativo</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2"><StatusChip status={p.status} metaMap={PROJECT_STATUS_META} /></td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{p.manager_name || <span className="text-gray-400">Sem gerente</span>}</td>
                      <td className="px-3 py-2"><PriorityCell project={p} canEdit={canEdit} onSave={saveField} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.action_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.open_count}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.overdue_count > 0 ? 'text-red-600 font-semibold' : ''}`}>{p.overdue_count}</td>
                      <td className="px-3 py-2"><ProgressCell pct={p.completion_pct} /></td>
                      <td className={`px-3 py-2 whitespace-nowrap tabular-nums ${overdueNext ? 'text-red-600 font-semibold' : soonNext ? 'text-amber-700 font-medium' : 'text-gray-700'}`}>
                        {formatDate(p.next_due_date)}
                      </td>
                      <td className="px-3 py-2">
                        <NotesCell key={p.notes ?? ''} project={p} canEdit={canEdit} onSave={saveField} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ProjectFormModal open={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
    </div>
  );
}
