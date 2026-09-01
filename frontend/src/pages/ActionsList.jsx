import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useActionFilters } from '../hooks/useActionFilters';
import FilterBar from '../components/FilterBar';
import StatusChip from '../components/StatusChip';
import ActionFormModal from '../components/ActionFormModal';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import { formatDate, formatHours, formatMonthYear } from '../utils/format';
import { FLAG_LABELS, PERMISSIONS } from '../utils/constants';
import { useAuth } from '../context/AuthContext';

const COLUMNS = [
  { key: 'id', label: 'ID', sortKey: 'business_id', width: 'w-16' },
  { key: 'project', label: 'Projeto', sortKey: 'project_name' },
  { key: 'refMonth', label: 'Mês Ref.', sortKey: 'ref_month' },
  { key: 'area', label: 'Área/Processo', sortKey: 'area_name' },
  { key: 'description', label: 'Ação' },
  { key: 'responsibleName', label: 'Responsável' },
  { key: 'plannedHours', label: 'Horas Plan.' },
  { key: 'actualHours', label: 'Horas Reais' },
  { key: 'varianceHours', label: 'Variação' },
  { key: 'startDate', label: 'Início', sortKey: 'start_date' },
  { key: 'dueDate', label: 'Prazo/Fim', sortKey: 'due_date' },
  { key: 'status', label: 'Status', sortKey: 'status' },
  { key: 'updatedAt', label: 'Atualizado', sortKey: 'updated_at' },
];

export default function ActionsList() {
  const { hasPermission } = useAuth();
  const { filters, setFilters, clearAll, activeCount, asQueryString } = useActionFilters();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('business_id');
  const [sortDir, setSortDir] = useState('asc');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [visibleCols, setVisibleCols] = useState(COLUMNS.map((c) => c.key));
  const navigate = useNavigate();
  const defaultProjectId = filters.projectId?.length === 1 ? filters.projectId[0] : undefined;

  useEffect(() => { setPage(1); }, [asQueryString]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams(asQueryString);
    qs.set('page', page);
    qs.set('pageSize', pageSize);
    qs.set('sortBy', sortBy);
    qs.set('sortDir', sortDir);
    api.get(`/actions?${qs.toString()}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asQueryString, page, pageSize, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (!col.sortKey) return;
    if (sortBy === col.sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col.sortKey); setSortDir('asc'); }
  };

  const handleExport = async (format) => {
    try {
      await downloadFile(`/actions/export?format=${format}&${asQueryString}`, `acoes.${format}`);
    } catch (err) {
      alert(err.message);
    }
  };

  const cols = COLUMNS.filter((c) => visibleCols.includes(c.key));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Ações</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExport('csv')} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">CSV</button>
          <button onClick={() => handleExport('xlsx')} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">XLSX</button>
          {hasPermission(PERMISSIONS.ACTIONS_CREATE) && (
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              + Nova ação
            </button>
          )}
        </div>
      </div>

      <FilterBar filters={filters} setFilters={setFilters} clearAll={clearAll} activeCount={activeCount} />

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} />}
      {data && !loading && data.items.length === 0 && (
        <EmptyState title="Nenhuma ação encontrada" description="Ajuste os filtros ou crie uma nova ação." />
      )}

      {data && !loading && data.items.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} className={`text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap ${c.width || ''} ${c.sortKey ? 'cursor-pointer select-none' : ''}`} onClick={() => toggleSort(c)}>
                        {c.label}{sortBy === c.sortKey && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.uuid} className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer" onClick={() => navigate(`/acoes/${item.id}`)}>
                      {visibleCols.includes('id') && <td className="px-3 py-2 font-mono text-gray-500">#{item.id}</td>}
                      {visibleCols.includes('project') && <td className="px-3 py-2">{item.project.name}</td>}
                      {visibleCols.includes('refMonth') && <td className="px-3 py-2 whitespace-nowrap">{formatMonthYear(item.refMonth)}</td>}
                      {visibleCols.includes('area') && <td className="px-3 py-2">{item.area.name}</td>}
                      {visibleCols.includes('description') && <td className="px-3 py-2 max-w-xs truncate" title={item.description}>{item.description}</td>}
                      {visibleCols.includes('responsibleName') && <td className="px-3 py-2">{item.responsibleName || <span className="text-amber-600 text-xs">Sem responsável</span>}</td>}
                      {visibleCols.includes('plannedHours') && <td className="px-3 py-2 text-right">{formatHours(item.plannedHours)}</td>}
                      {visibleCols.includes('actualHours') && <td className="px-3 py-2 text-right">{formatHours(item.actualHours)}</td>}
                      {visibleCols.includes('varianceHours') && <td className={`px-3 py-2 text-right font-medium ${item.varianceHours > 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatHours(item.varianceHours)}</td>}
                      {visibleCols.includes('startDate') && <td className="px-3 py-2 whitespace-nowrap">{formatDate(item.startDate)}</td>}
                      {visibleCols.includes('dueDate') && <td className={`px-3 py-2 whitespace-nowrap ${item.overdue ? 'text-red-600 font-semibold' : ''}`}>{formatDate(item.dueDate || item.completionDate)}</td>}
                      {visibleCols.includes('status') && <td className="px-3 py-2"><StatusChip status={item.status} /></td>}
                      {visibleCols.includes('updatedAt') && <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatDate(item.updatedAt)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {data.items.map((item) => (
              <button key={item.uuid} onClick={() => navigate(`/acoes/${item.id}`)} className="w-full text-left bg-white border border-[var(--color-border)] rounded-xl p-4">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className="font-mono text-xs text-gray-400">#{item.id}</span>
                  <StatusChip status={item.status} />
                </div>
                <p className="font-medium text-gray-900 text-sm mb-1 line-clamp-2">{item.description}</p>
                <p className="text-xs text-gray-500 mb-2">{item.project.name} · {item.area.name}</p>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{item.responsibleName || 'Sem responsável'}</span>
                  <span className={item.overdue ? 'text-red-600 font-semibold' : ''}>{formatDate(item.dueDate || item.completionDate)}</span>
                </div>
                {item.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.flags.map((f) => (
                      <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">{FLAG_LABELS[f] || f}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
            <p className="text-sm text-gray-500">
              {data.total} ações · página {data.page} de {data.totalPages || 1}
            </p>
            <div className="flex items-center gap-2">
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="input !w-auto py-1">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
              </select>
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-40">Anterior</button>
              <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-40">Próxima</button>
            </div>
          </div>
        </>
      )}

      <ActionFormModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setPage(1); setLoading(true); api.get(`/actions?${asQueryString}&page=1&pageSize=${pageSize}`).then(setData).finally(() => setLoading(false)); }} defaultProjectId={defaultProjectId} />
    </div>
  );
}
