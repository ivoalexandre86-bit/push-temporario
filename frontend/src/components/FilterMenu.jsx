import { useEffect, useRef, useState } from 'react';
import MultiSelect from './MultiSelect';
import { STATUSES, STATUS_META, PROJECT_STATUSES, PROJECT_STATUS_META } from '../utils/constants';
import { useCatalogs } from '../hooks/useCatalogs';
import { formatMonthYear } from '../utils/format';

const PICKED_KEY = 'painel.filtros.escolhidos';

const isSet = (v) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== undefined && v !== null && v !== false);

/**
 * Same filters as FilterBar, but behind a single "Filtros" button: the user
 * picks which filters to use, then sets their values. Filters that already
 * have a value are always shown. Values go through the same setFilters, so
 * URLs, session defaults and saved panels keep working unchanged.
 */
export default function FilterMenu({ filters, setFilters, clearAll, activeCount }) {
  const { projects, areas, people, refMonths } = useCatalogs();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PICKED_KEY) || '[]'); } catch { return []; }
  });
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const years = Array.from({ length: 6 }, (_, i) => String(2023 + i));

  const multi = (key, label, options) => ({
    id: key, label, keys: [key],
    render: () => <MultiSelect label={label} options={options} value={filters[key]} onChange={(v) => setFilters({ [key]: v })} />,
  });
  const field = (key, label, type) => ({
    id: key, label, keys: [key],
    render: () => (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <input
          type={type}
          step={type === 'number' ? '0.5' : undefined}
          value={filters[key]}
          onChange={(e) => setFilters({ [key]: e.target.value })}
          className={`${type === 'number' ? 'w-28' : ''} rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500`}
        />
      </div>
    ),
  });
  const flag = (key, label) => ({
    id: key, label, keys: [key],
    render: () => (
      <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
        <input
          type="checkbox"
          checked={filters[key] === 'true' || filters[key] === true}
          onChange={(e) => setFilters({ [key]: e.target.checked ? 'true' : '' })}
          className="rounded border-gray-300 text-blue-600"
        />
        {label}
      </label>
    ),
  });

  const defs = [
    multi('projectId', 'Projeto', projects.map((p) => ({ value: p.id, label: p.name }))),
    multi('areaId', 'Área/Processo', areas.map((a) => ({ value: a.id, label: a.name }))),
    multi('status', 'Status', STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))),
    multi('projectStatus', 'Status do Projeto', PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_META[s].label }))),
    multi('responsible', 'Responsável', people.map((p) => ({ value: p.name, label: p.name }))),
    multi('year', 'Ano', years.map((y) => ({ value: y, label: y }))),
    multi('refMonth', 'Mês', refMonths.map((m) => ({ value: m, label: formatMonthYear(m) }))),
    {
      id: 'q', label: 'Buscar', keys: ['q'],
      render: () => (
        <div className="min-w-[14rem]">
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="painel-filter-q">Buscar</label>
          <input
            id="painel-filter-q"
            type="search"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
            placeholder="Ação ou observações..."
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ),
    },
    field('startFrom', 'Início de', 'date'),
    field('startTo', 'Início até', 'date'),
    field('endFrom', 'Prazo de', 'date'),
    field('endTo', 'Prazo até', 'date'),
    field('plannedMin', 'Horas planej. mín.', 'number'),
    field('plannedMax', 'Horas planej. máx.', 'number'),
    field('actualMin', 'Horas reais mín.', 'number'),
    field('actualMax', 'Horas reais máx.', 'number'),
    flag('overdue', 'Somente atrasadas'),
    flag('unassigned', 'Sem responsável'),
  ];

  const hasValue = (d) => d.keys.some((k) => isSet(filters[k]));
  const shown = defs.filter((d) => picked.includes(d.id) || hasValue(d));

  const togglePick = (d) => {
    let next;
    if (picked.includes(d.id) || hasValue(d)) {
      next = picked.filter((id) => id !== d.id);
      if (hasValue(d)) setFilters(Object.fromEntries(d.keys.map((k) => [k, Array.isArray(filters[k]) ? [] : ''])));
    } else {
      next = [...picked, d.id];
    }
    setPicked(next);
    try { localStorage.setItem(PICKED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium ${activeCount > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filtros
        {activeCount > 0 && (
          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Filtros" className="absolute right-0 z-30 mt-2 w-[min(46rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white shadow-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-800">Filtros</p>
            <button
              type="button"
              onClick={() => { clearAll(); }}
              disabled={activeCount === 0}
              className="text-sm font-medium text-blue-700 hover:underline disabled:text-gray-300 disabled:no-underline"
            >
              Limpar{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-2">Escolha os filtros que deseja usar:</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {defs.map((d) => {
              const on = picked.includes(d.id) || hasValue(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => togglePick(d)}
                  aria-pressed={on}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  {on ? '✓ ' : '+ '}{d.label}
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">Nenhum filtro escolhido. Clique em um filtro acima para usá-lo.</p>
          ) : (
            <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-gray-100">
              {shown.map((d) => <div key={d.id}>{d.render()}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
