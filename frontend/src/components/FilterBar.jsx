import { useState } from 'react';
import MultiSelect from './MultiSelect';
import { STATUSES, STATUS_META } from '../utils/constants';
import { useCatalogs } from '../hooks/useCatalogs';
import { formatMonthYear } from '../utils/format';

export default function FilterBar({ filters, setFilters, clearAll, activeCount }) {
  const { projects, areas, people, refMonths } = useCatalogs();
  const [showMore, setShowMore] = useState(false);

  const years = Array.from({ length: 6 }, (_, i) => String(2023 + i));

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl p-3 md:p-4 mb-4">
      <div className="flex flex-wrap gap-3 items-end">
        <MultiSelect
          label="Projeto"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          value={filters.projectId}
          onChange={(v) => setFilters({ projectId: v })}
        />
        <MultiSelect
          label="Área/Processo"
          options={areas.map((a) => ({ value: a.id, label: a.name }))}
          value={filters.areaId}
          onChange={(v) => setFilters({ areaId: v })}
        />
        <MultiSelect
          label="Status"
          options={STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))}
          value={filters.status}
          onChange={(v) => setFilters({ status: v })}
        />
        <MultiSelect
          label="Responsável"
          options={people.map((p) => ({ value: p.name, label: p.name }))}
          value={filters.responsible}
          onChange={(v) => setFilters({ responsible: v })}
        />
        <MultiSelect
          label="Ano"
          options={years.map((y) => ({ value: y, label: y }))}
          value={filters.year}
          onChange={(v) => setFilters({ year: v })}
        />
        <MultiSelect
          label="Mês"
          options={refMonths.map((m) => ({ value: m, label: formatMonthYear(m) }))}
          value={filters.refMonth}
          onChange={(v) => setFilters({ refMonth: v })}
        />

        <div className="flex-1 min-w-[10rem]">
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="filter-q">Buscar</label>
          <input
            id="filter-q"
            type="search"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
            placeholder="Ação ou observações..."
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          aria-expanded={showMore}
        >
          {showMore ? 'Menos filtros' : 'Mais filtros'}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="px-3 py-1.5 rounded-md text-sm text-blue-700 hover:bg-blue-50 font-medium"
          >
            Limpar filtros ({activeCount})
          </button>
        )}
      </div>

      {showMore && (
        <div className="flex flex-wrap gap-3 items-end mt-3 pt-3 border-t border-gray-100">
          <DateField label="Início de" value={filters.startFrom} onChange={(v) => setFilters({ startFrom: v })} />
          <DateField label="Início até" value={filters.startTo} onChange={(v) => setFilters({ startTo: v })} />
          <DateField label="Prazo de" value={filters.endFrom} onChange={(v) => setFilters({ endFrom: v })} />
          <DateField label="Prazo até" value={filters.endTo} onChange={(v) => setFilters({ endTo: v })} />
          <NumberField label="Horas planej. mín." value={filters.plannedMin} onChange={(v) => setFilters({ plannedMin: v })} />
          <NumberField label="Horas planej. máx." value={filters.plannedMax} onChange={(v) => setFilters({ plannedMax: v })} />
          <NumberField label="Horas reais mín." value={filters.actualMin} onChange={(v) => setFilters({ actualMin: v })} />
          <NumberField label="Horas reais máx." value={filters.actualMax} onChange={(v) => setFilters({ actualMax: v })} />
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
            <input type="checkbox" checked={filters.overdue === 'true' || filters.overdue === true} onChange={(e) => setFilters({ overdue: e.target.checked ? 'true' : '' })} className="rounded border-gray-300 text-blue-600" />
            Somente atrasadas
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
            <input type="checkbox" checked={filters.unassigned === 'true' || filters.unassigned === true} onChange={(e) => setFilters({ unassigned: e.target.checked ? 'true' : '' })} className="rounded border-gray-300 text-blue-600" />
            Sem responsável
          </label>
        </div>
      )}
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type="number" step="0.5" value={value} onChange={(e) => onChange(e.target.value)} className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
    </div>
  );
}
