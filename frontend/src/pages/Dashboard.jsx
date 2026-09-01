import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import { api } from '../api/client';
import { useActionFilters } from '../hooks/useActionFilters';
import FilterBar from '../components/FilterBar';
import KpiCard from '../components/KpiCard';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import { formatHours, formatMonthYear, formatNumber, formatPercent } from '../utils/format';
import { CHART_COLORS, STATUS_META } from '../utils/constants';

export default function Dashboard() {
  const { filters, setFilters, clearAll, activeCount, asQueryString } = useActionFilters();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/dashboard?${asQueryString}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asQueryString]);

  const goToActions = (extraFilters) => {
    const params = new URLSearchParams(asQueryString);
    for (const [k, v] of Object.entries(extraFilters)) params.set(k, v);
    navigate(`/acoes?${params.toString()}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Painel</h1>
      </div>

      <FilterBar filters={filters} setFilters={setFilters} clearAll={clearAll} activeCount={activeCount} />

      {loading && <Loading label="Carregando indicadores..." />}
      {error && !loading && <ErrorState message={error} />}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
            <KpiCard label="Total de ações" value={data.totalActions} onClick={() => goToActions({})} />
            <KpiCard label="Em aberto" value={data.openActions} tone="blue" onClick={() => goToActions({ status: 'ANDAMENTO,EM ESTUDO' })} />
            <KpiCard label="Concluídas" value={data.completedActions} tone="green" onClick={() => goToActions({ status: 'CONCLUÍDO' })} />
            <KpiCard label="Canceladas" value={data.cancelledActions} tone="red" onClick={() => goToActions({ status: 'CANCELADO' })} />
            <KpiCard label="Atrasadas" value={data.overdueActions} tone="red" onClick={() => goToActions({ overdue: 'true' })} />
            <KpiCard label="Vencem em 7 dias" value={data.dueSoonActions} tone="amber" onClick={() => goToActions({ dueSoonDays: '7' })} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard label="% Conclusão" value={formatPercent(data.completionPct)} />
            <KpiCard label="Horas planejadas" value={formatHours(data.hours.planned)} />
            <KpiCard label="Horas reais" value={formatHours(data.hours.actual)} />
            <KpiCard
              label="Variação de horas"
              value={formatHours(data.hours.variance)}
              tone={data.hours.variance > 0 ? 'red' : 'green'}
              sublabel={data.hours.utilizationPct !== null ? `${formatPercent(data.hours.utilizationPct)} de utilização` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <ChartCard title="Ações por status">
              {data.totalActions === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={Object.entries(data.byStatus).map(([status, count]) => ({ name: STATUS_META[status]?.label || status, status, value: count }))}
                      dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                      onClick={(entry) => goToActions({ status: entry.status })}
                      cursor="pointer"
                    >
                      {Object.keys(data.byStatus).map((status, i) => (
                        <Cell key={status} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Tendência mensal">
              {data.monthlyTrend.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.monthlyTrend.map((m) => ({ ...m, monthLabel: formatMonthYear(m.month) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="monthLabel" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="created" name="Criadas" stroke={CHART_COLORS[0]} strokeWidth={2} />
                    <Line type="monotone" dataKey="completed" name="Concluídas" stroke={CHART_COLORS[1]} strokeWidth={2} />
                    <Line type="monotone" dataKey="overdue" name="Atrasadas" stroke={CHART_COLORS[3]} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <ChartCard title="Ações por projeto (clique para filtrar)">
              {data.byProject.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={Math.max(220, data.byProject.length * 32)}>
                  <BarChart data={data.byProject} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis type="category" dataKey="name" width={150} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="Ações" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} onClick={(entry) => goToActions({ projectId: entry.id })} cursor="pointer" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Ações por área/processo (clique para filtrar)">
              {data.byArea.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={Math.max(220, Math.min(data.byArea.length, 15) * 26)}>
                  <BarChart data={data.byArea.slice(0, 15)} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" fontSize={12} />
                    <YAxis type="category" dataKey="name" width={150} fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="Ações" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} onClick={(entry) => goToActions({ areaId: entry.id })} cursor="pointer" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Carga de trabalho por responsável">
              {data.workloadByResponsible.length === 0 ? <EmptyState /> : (
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-2 font-medium">Responsável</th>
                        <th className="py-2 pr-2 font-medium text-right">Ações</th>
                        <th className="py-2 pr-2 font-medium text-right">Em aberto</th>
                        <th className="py-2 pr-2 font-medium text-right">Horas reais</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.workloadByResponsible.map((w) => (
                        <tr key={w.responsible} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => goToActions({ responsible: w.responsible })}>
                          <td className="py-2 pr-2">{w.responsible}</td>
                          <td className="py-2 pr-2 text-right">{w.count}</td>
                          <td className="py-2 pr-2 text-right">{w.openCount}</td>
                          <td className="py-2 pr-2 text-right">{formatHours(w.actualHours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>

            <ChartCard title="Top projetos/áreas com mais atrasos">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Projetos com mais ações em aberto</p>
                  <ul className="space-y-1.5">
                    {data.topOpenProjects.map((p) => (
                      <li key={p.id} className="flex justify-between text-sm cursor-pointer hover:text-blue-600" onClick={() => goToActions({ projectId: p.id })}>
                        <span>{p.name}</span>
                        <span className="font-semibold">{p.openCount} {p.overdueCount > 0 && <span className="text-red-600">({p.overdueCount} atrasadas)</span>}</span>
                      </li>
                    ))}
                    {data.topOpenProjects.length === 0 && <li className="text-sm text-gray-400">Nenhum dado</li>}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Áreas/processos com mais atrasos</p>
                  <ul className="space-y-1.5">
                    {data.topOverdueAreas.filter((a) => a.overdueCount > 0).map((a) => (
                      <li key={a.id} className="flex justify-between text-sm cursor-pointer hover:text-blue-600" onClick={() => goToActions({ areaId: a.id, overdue: 'true' })}>
                        <span>{a.name}</span>
                        <span className="font-semibold text-red-600">{a.overdueCount}</span>
                      </li>
                    ))}
                    {data.topOverdueAreas.filter((a) => a.overdueCount > 0).length === 0 && <li className="text-sm text-gray-400">Nenhuma área com atrasos no filtro atual</li>}
                  </ul>
                </div>
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-2">{title}</h2>
      {children}
    </div>
  );
}
