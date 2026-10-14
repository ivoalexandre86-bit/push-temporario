import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import MultiSelect from '../components/MultiSelect';
import FilterPanel, { FilterToggleButton, useFiltersCollapsed } from '../components/FilterPanel';
import KpiCard from '../components/KpiCard';
import ProjectFormModal from '../components/ProjectFormModal';
import ColumnChooser, { usePersistentColumns, SortHeader, Chevron } from '../components/ColumnChooser';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  PERMISSIONS, PROJECT_STATUSES, PROJECT_STATUS_META,
  GRID_STATUS_COLORS, pillStyle,
} from '../utils/constants';
import { formatDate, formatPercent } from '../utils/format';

const NONE = 'none';

const STATUS_KPIS = [
  { status: 'ANDAMENTO', tone: 'blue' },
  { status: 'PARADO', tone: 'amber' },
  { status: 'CONCLUÍDO', tone: 'green' },
  { status: 'CANCELADO', tone: 'red' },
];

const PCT_RANGES = [
  { value: '0-25', label: '0–25%', min: 0, max: 25 },
  { value: '25-50', label: '25–50%', min: 25, max: 50 },
  { value: '50-75', label: '50–75%', min: 50, max: 75 },
  { value: '75-100', label: '75–100%', min: 75, max: 100 },
];

// Filters kept in the query string (multi-value ones as comma-separated lists).
const LIST_KEYS = ['project', 'status', 'manager', 'priority', 'pct'];
const FLAG_KEYS = ['open', 'overdue', 'soon'];

const COLUMNS_STORAGE_KEY = 'projetos.grid.columns';

const COLUMNS = [
  { key: 'name', label: 'Projeto', get: (p) => p.name.toLowerCase(), locked: true },
  { key: 'status', label: 'Status do projeto', get: (p) => PROJECT_STATUS_META[p.status]?.label || p.status },
  { key: 'manager', label: 'Gerente', get: (p) => p.manager_name?.toLowerCase() ?? null },
  // Numeric priority, 1 = highest: ascending sort puts the most important first.
  { key: 'priority', label: 'Prioridade', get: (p) => p.priority ?? null, numeric: true },
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
    if (f.priority.length && !f.priority.includes(p.priority != null ? String(p.priority) : NONE)) return false;
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

function StatusCell({ project, canEdit, onSave }) {
  const meta = PROJECT_STATUS_META[project.status];
  const color = GRID_STATUS_COLORS[project.status];
  const dot = <span className="dg-dot" style={{ background: color }} aria-hidden="true" />;
  if (!canEdit) {
    return <span className="dg-pill" style={pillStyle(color)}>{dot}{meta?.label || project.status}</span>;
  }
  return (
    <span className="dg-pill" style={pillStyle(color)}>
      {dot}
      <select
        value={project.status}
        onChange={(e) => onSave(project, { status: e.target.value })}
        aria-label={`Status de ${project.name}`}
      >
        {PROJECT_STATUSES.map((st) => <option key={st} value={st}>{PROJECT_STATUS_META[st].label}</option>)}
      </select>
    </span>
  );
}

function PriorityCell({ project, canEdit, onSave }) {
  const current = project.priority != null ? String(project.priority) : '';
  const [draft, setDraft] = useState(current);
  const cancelRef = useRef(false);
  const toast = useToast();

  if (!canEdit) {
    return current ? <span className="font-semibold tabular-nums">{current}</span> : <span className="muted">—</span>;
  }

  const commit = () => {
    if (cancelRef.current) { cancelRef.current = false; return; }
    const value = draft.trim();
    if (value === current) return;
    if (value === '') { onSave(project, { priority: null }); return; }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      toast.error('A prioridade deve ser um número inteiro de 1 a 999 (1 = mais prioritário).');
      setDraft(current);
      return;
    }
    onSave(project, { priority: n });
  };

  return (
    <input
      type="number"
      min={1}
      max={999}
      step={1}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelRef.current = true;
          setDraft(current);
          e.currentTarget.blur();
        }
      }}
      placeholder="—"
      aria-label={`Prioridade de ${project.name} (1 = mais prioritário)`}
      title="1 = mais prioritário"
      className="dg-input w-16 text-right tabular-nums"
    />
  );
}

function NotesCell({ project, canEdit, onSave }) {
  const [draft, setDraft] = useState(project.notes || '');
  const cancelRef = useRef(false);

  if (!canEdit) {
    return project.notes
      ? <span className="block max-w-[18rem] truncate" title={project.notes}>{project.notes}</span>
      : <span className="muted">—</span>;
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
      className="dg-input w-56"
    />
  );
}

function ProgressCell({ pct }) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="dg-progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums w-14 text-right">{formatPercent(value)}</span>
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
  const [filtersCollapsed, toggleFilters] = useFiltersCollapsed();
  const canEdit = hasPermission(PERMISSIONS.PROJECTS_MANAGE);
  const lockedCols = COLUMNS.filter((c) => c.locked).map((c) => c.key);
  const [visibleCols, setVisibleCols] = usePersistentColumns(COLUMNS_STORAGE_KEY, COLUMNS, lockedCols);
  const shownColumns = COLUMNS.filter((c) => visibleCols.includes(c.key));

  const reload = () => api.get('/projects').then((d) => setProjects(d.items)).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  const saveField = async (project, patch) => {
    const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, project[k]]));
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

  // KPI counts by project status: every other filter applies, the status
  // filter does not, so the other statuses stay visible after clicking one.
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(PROJECT_STATUSES.map((st) => [st, 0]));
    let total = 0;
    for (const p of applyFilters(projects || [], { ...filters, status: [] })) {
      total += 1;
      if (p.status in counts) counts[p.status] += 1;
    }
    return { counts, total };
  }, [projects, filters]);

  const priorityOptions = useMemo(() => {
    const values = [...new Set((projects || []).map((p) => p.priority).filter((v) => v != null))].sort((a, b) => a - b);
    return [{ value: NONE, label: 'Sem prioridade' }, ...values.map((v) => ({ value: String(v), label: String(v) }))];
  }, [projects]);

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
        <div className="flex items-center gap-2">
          {projects.length > 0 && (
            <FilterToggleButton collapsed={filtersCollapsed} onToggle={toggleFilters} activeCount={activeCount} />
          )}
          {canEdit && (
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              + Novo projeto
            </button>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState title="Nenhum projeto disponível" description="Você ainda não tem acesso a nenhum projeto." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <KpiCard
              label="Projetos"
              value={statusCounts.total}
              onClick={() => setFilters({ status: [] })}
              active={filters.status.length === 0}
              sublabel={filters.status.length === 0 ? 'Todos os status' : 'Mostrar todos'}
            />
            {STATUS_KPIS.map(({ status, tone }) => {
              const on = filters.status.includes(status);
              return (
                <KpiCard
                  key={status}
                  label={PROJECT_STATUS_META[status]?.label || status}
                  value={statusCounts.counts[status] ?? 0}
                  tone={tone}
                  // Click filters the grid by this status; clicking it again removes the filter.
                  onClick={() => setFilters({ status: on && filters.status.length === 1 ? [] : [status] })}
                  active={on}
                  sublabel={on ? 'Filtro ativo' : undefined}
                />
              );
            })}
          </div>

          {/* Filters live behind the "Filtros" button (minimized by default); the
              KPIs take their place at the top of the page. */}
          {!filtersCollapsed && (
          <FilterPanel activeCount={activeCount} onClear={clearAll} collapsed={false} onToggle={toggleFilters}>
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
                options={priorityOptions}
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
              </div>
            </div>
          </FilterPanel>
          )}

          <div className="dg">
            <div className="overflow-x-auto scrollbar-thin">
              <table>
                <thead>
                  <tr>
                    {shownColumns.map((c) => {
                      const active = filters.sort === c.key;
                      return (
                        <th
                          key={c.key}
                          scope="col"
                          aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          className={c.numeric ? 'num' : ''}
                        >
                          <SortHeader label={c.label} active={active} dir={filters.dir} onClick={() => toggleSort(c.key)} />
                        </th>
                      );
                    })}
                    <th scope="col" className="num" style={{ width: '3rem' }}>
                      <ColumnChooser columns={COLUMNS} visible={visibleCols} onChange={setVisibleCols} locked={lockedCols} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={shownColumns.length + 1} className="muted" style={{ textAlign: 'center', padding: '2rem 0.75rem' }}>
                        Nenhum projeto corresponde aos filtros.
                      </td>
                    </tr>
                  )}
                  {visible.map((p) => {
                    const overdueNext = p.next_due_date && p.next_due_date < today;
                    const soonNext = p.next_due_date && !overdueNext && p.next_due_date <= soonLimit;
                    const cells = {
                      name: (
                        <div className="flex items-center gap-2">
                          <Link to={`/acoes?projectId=${p.id}`} className="dg-link whitespace-nowrap">{p.name}</Link>
                          {!p.active && <span className="dg-pill" style={pillStyle('#94a3b8')}>Inativo</span>}
                        </div>
                      ),
                      status: <StatusCell project={p} canEdit={canEdit} onSave={saveField} />,
                      manager: p.manager_name
                        ? <span className="whitespace-nowrap">{p.manager_name}</span>
                        : <span className="muted whitespace-nowrap">Sem gerente</span>,
                      priority: <PriorityCell project={p} canEdit={canEdit} onSave={saveField} />,
                      actions: p.action_count,
                      open: p.open_count,
                      overdue: <span className={p.overdue_count > 0 ? 'danger' : ''}>{p.overdue_count}</span>,
                      pct: <ProgressCell pct={p.completion_pct} />,
                      nextDue: (
                        <span className={`whitespace-nowrap tabular-nums ${overdueNext ? 'danger' : soonNext ? 'warn' : p.next_due_date ? '' : 'muted'}`}>
                          {formatDate(p.next_due_date)}
                        </span>
                      ),
                      notes: <NotesCell key={p.notes ?? ''} project={p} canEdit={canEdit} onSave={saveField} />,
                    };
                    return (
                      <tr key={p.id} style={{ '--row-accent': GRID_STATUS_COLORS[p.status] || '#334155' }}>
                        {shownColumns.map((c) => <td key={c.key} className={c.numeric ? 'num' : ''}>{cells[c.key]}</td>)}
                        <td className="num">
                          <Link to={`/acoes?projectId=${p.id}`} className="dg-chevron" aria-label={`Abrir ações de ${p.name}`} title="Abrir ações do projeto">
                            <Chevron />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ProjectFormModal open={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
    </div>
  );
}
