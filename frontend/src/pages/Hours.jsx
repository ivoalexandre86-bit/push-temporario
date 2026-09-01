import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useActionFilters } from '../hooks/useActionFilters';
import FilterBar from '../components/FilterBar';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import { formatDate, formatHours, formatMonthYear } from '../utils/format';
import { PERMISSIONS } from '../utils/constants';

export default function Hours() {
  const { hasPermission, user } = useAuth();
  const { filters, setFilters, clearAll, activeCount, asQueryString } = useActionFilters();
  const [plannedVsActual, setPlannedVsActual] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const calls = [
      api.get(`/reports/planned-vs-actual?${asQueryString}`),
      api.get(`/reports/workload?${asQueryString}`),
      hasPermission(PERMISSIONS.HOURS_APPROVE) ? api.get('/time-entries?approvalStatus=PENDING') : Promise.resolve({ items: [] }),
    ];
    Promise.all(calls)
      .then(([pva, wl, pend]) => { if (!cancelled) { setPlannedVsActual(pva.rows); setWorkload(wl.rows); setPending(pend.items); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asQueryString, hasPermission]);

  const approve = async (id, ok) => {
    await api.patch(`/time-entries/${id}/approve`, { approve: ok });
    setPending((p) => p.filter((e) => e.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Horas</h1>
        {hasPermission(PERMISSIONS.REPORTS_EXPORT) && (
          <div className="flex gap-2">
            <button onClick={() => downloadFile(`/reports/planned-vs-actual/export?format=xlsx&${asQueryString}`, 'planejado-vs-real.xlsx')} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
              Exportar XLSX
            </button>
          </div>
        )}
      </div>

      <FilterBar filters={filters} setFilters={setFilters} clearAll={clearAll} activeCount={activeCount} />

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} />}

      {!loading && !error && (
        <div className="space-y-4">
          {hasPermission(PERMISSIONS.HOURS_APPROVE) && pending.length > 0 && (
            <div className="bg-white border border-amber-200 bg-amber-50/40 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Lançamentos pendentes de aprovação ({pending.length})</h2>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="py-1.5 pr-2 font-medium">Ação</th>
                      <th className="py-1.5 pr-2 font-medium">Usuário</th>
                      <th className="py-1.5 pr-2 font-medium">Data</th>
                      <th className="py-1.5 pr-2 font-medium text-right">Horas</th>
                      <th className="py-1.5 pr-2 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((e) => (
                      <tr key={e.id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-2">#{e.business_id} — {e.action_description?.slice(0, 40)}</td>
                        <td className="py-1.5 pr-2">{e.user_name}</td>
                        <td className="py-1.5 pr-2">{formatDate(e.entry_date)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatHours(e.hours)}</td>
                        <td className="py-1.5 pr-2">
                          <button onClick={() => approve(e.id, true)} className="text-xs text-green-700 hover:underline mr-2">Aprovar</button>
                          <button onClick={() => approve(e.id, false)} className="text-xs text-red-700 hover:underline">Rejeitar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Planejado vs. Real por projeto e mês</h2>
            {plannedVsActual?.length === 0 ? <EmptyState /> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="py-1.5 pr-3 font-medium">Projeto</th>
                      <th className="py-1.5 pr-3 font-medium">Mês</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Planejadas</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Reais</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plannedVsActual?.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3">{r.project}</td>
                        <td className="py-1.5 pr-3">{formatMonthYear(r.month)}</td>
                        <td className="py-1.5 pr-3 text-right">{formatHours(r.planned_hours)}</td>
                        <td className="py-1.5 pr-3 text-right">{formatHours(r.actual_hours)}</td>
                        <td className={`py-1.5 pr-3 text-right font-medium ${r.variance_hours > 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatHours(r.variance_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Horas por responsável</h2>
            {workload?.length === 0 ? <EmptyState /> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="py-1.5 pr-3 font-medium">Responsável</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Total de ações</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Em aberto</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Planejadas</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Reais</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload?.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-1.5 pr-3">{r.responsible}</td>
                        <td className="py-1.5 pr-3 text-right">{r.total}</td>
                        <td className="py-1.5 pr-3 text-right">{r.open}</td>
                        <td className="py-1.5 pr-3 text-right">{formatHours(r.planned_hours)}</td>
                        <td className="py-1.5 pr-3 text-right">{formatHours(r.actual_hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
