import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { useCatalogs } from '../hooks/useCatalogs';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import { formatDateTime } from '../utils/format';

const ENTITY_TYPES = ['ACTION', 'USER', 'PROJECT', 'AREA', 'TIME_ENTRY', 'AUTH', 'EXPORT'];

export default function Audit() {
  const { projects } = useCatalogs();
  const [filters, setFilters] = useState({ entityType: '', projectId: '', businessId: '', actionType: '', dateFrom: '', dateTo: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    qs.set('page', page);
    api.get(`/audit?${qs.toString()}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, page]);

  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const exportQs = () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    return qs.toString();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Auditoria</h1>
        <div className="flex gap-2">
          <button onClick={() => downloadFile(`/audit/export?format=csv&${exportQs()}`, 'auditoria.csv')} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">CSV</button>
          <button onClick={() => downloadFile(`/audit/export?format=xlsx&${exportQs()}`, 'auditoria.xlsx')} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">XLSX</button>
        </div>
      </div>

      <div className="bg-white border border-[var(--color-border)] rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Entidade</label>
          <select value={filters.entityType} onChange={(e) => set({ entityType: e.target.value })} className="input">
            <option value="">Todas</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Projeto</label>
          <select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })} className="input">
            <option value="">Todos</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ID da ação</label>
          <input type="number" value={filters.businessId} onChange={(e) => set({ businessId: e.target.value })} className="input !w-28" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tipo de alteração</label>
          <input value={filters.actionType} onChange={(e) => set({ actionType: e.target.value })} placeholder="UPDATE, CREATE..." className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">De</label>
          <input type="date" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Até</label>
          <input type="date" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} className="input" />
        </div>
      </div>

      {loading && <Loading />}
      {error && !loading && <ErrorState message={error} />}
      {data && !loading && data.items.length === 0 && <EmptyState title="Nenhum registro de auditoria encontrado" />}

      {data && !loading && data.items.length > 0 && (
        <>
          <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Data/Hora</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Entidade</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Ação #</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Projeto</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Tipo</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Campo</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Valor anterior</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Novo valor</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Usuário</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((ev) => (
                    <tr key={ev.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(ev.created_at)}</td>
                      <td className="px-3 py-2">{ev.entity_type}</td>
                      <td className="px-3 py-2">{ev.business_id ?? '—'}</td>
                      <td className="px-3 py-2">{ev.project_name || '—'}</td>
                      <td className="px-3 py-2">{ev.action_type}</td>
                      <td className="px-3 py-2">{ev.field_name || '—'}</td>
                      <td className="px-3 py-2 max-w-[12rem] truncate" title={ev.old_value}>{ev.old_value ?? '—'}</td>
                      <td className="px-3 py-2 max-w-[12rem] truncate" title={ev.new_value}>{ev.new_value ?? '—'}</td>
                      <td className="px-3 py-2">{ev.actor_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-sm text-gray-500">{data.total} registros · página {data.page} de {data.totalPages || 1}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-40">Anterior</button>
              <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-40">Próxima</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
