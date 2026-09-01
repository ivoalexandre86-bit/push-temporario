import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useActionFilters } from '../hooks/useActionFilters';
import FilterBar from '../components/FilterBar';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import { formatDate, formatNumber } from '../utils/format';

const REPORT_TYPES = [
  { key: 'monthly-status-summary', label: 'Resumo mensal de status' },
  { key: 'project-performance', label: 'Desempenho por projeto' },
  { key: 'area-performance', label: 'Desempenho por área/processo' },
  { key: 'workload', label: 'Carga de trabalho por responsável' },
  { key: 'overdue', label: 'Ações atrasadas' },
  { key: 'planned-vs-actual', label: 'Horas planejadas vs. reais' },
];

export default function Reports() {
  const { filters, setFilters, clearAll, activeCount, asQueryString } = useActionFilters();
  const [type, setType] = useState(REPORT_TYPES[0].key);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/reports/${type}?${asQueryString}`)
      .then((d) => { if (!cancelled) setReport(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [type, asQueryString]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Relatórios</h1>
        <div className="flex gap-2">
          <button onClick={() => downloadFile(`/reports/${type}/export?format=csv&${asQueryString}`, `${type}.csv`)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">CSV</button>
          <button onClick={() => downloadFile(`/reports/${type}/export?format=xlsx&${asQueryString}`, `${type}.xlsx`)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">XLSX</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Tipo de relatório">
        {REPORT_TYPES.map((rt) => (
          <button
            key={rt.key}
            role="tab"
            aria-selected={type === rt.key}
            onClick={() => setType(rt.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${type === rt.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {rt.label}
          </button>
        ))}
      </div>

      <FilterBar filters={filters} setFilters={setFilters} clearAll={clearAll} activeCount={activeCount} />

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} />}

      {report && !loading && (
        report.rows.length === 0 ? <EmptyState title="Nenhum dado para os filtros selecionados" /> : (
          <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {report.columns.map((c) => (
                      <th key={c.key} className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      {report.columns.map((c) => (
                        <td key={c.key} className="px-3 py-2 whitespace-nowrap">{formatCell(c.key, row[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function formatCell(key, value) {
  if (value === null || value === undefined) return '—';
  if (/date|month|month_ref|effective_date/i.test(key)) return formatDate(value);
  if (typeof value === 'number') return formatNumber(value);
  return value;
}
