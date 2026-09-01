import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loading, ErrorState } from '../components/Loading';
import ActionFormModal from '../components/ActionFormModal';
import { formatDateTime, formatHours, formatMonthYear, formatPercent } from '../utils/format';
import { PERMISSIONS, STATUS_META, CHART_COLORS } from '../utils/constants';

export default function ProjectWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [project, setProject] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const reload = () => {
    setLoading(true);
    return Promise.all([
      api.get(`/projects/${id}`),
      api.get(`/dashboard?projectId=${id}`),
      hasPermission(PERMISSIONS.AUDIT_VIEW) ? api.get(`/audit?projectId=${id}&pageSize=15`) : Promise.resolve({ items: [] }),
    ])
      .then(([p, d, a]) => { setProject(p); setDashboard(d); setActivity(a.items); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasPermission]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!project || !dashboard) return null;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <Link to="/projetos" className="hover:underline">Projetos</Link>
        <span>/</span>
        <span>{project.name}</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
          {project.description && <p className="text-sm text-gray-500 mt-1 max-w-xl">{project.description}</p>}
          <p className="text-xs text-gray-400 mt-1">Gerente: {project.manager_name || 'não definido'}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission(PERMISSIONS.ACTIONS_CREATE) && (
            <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              + Nova ação
            </button>
          )}
          <button onClick={() => navigate(`/acoes?projectId=${id}`)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            Ver todas as ações
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Total" value={dashboard.totalActions} />
        <Kpi label="Em aberto" value={dashboard.openActions} />
        <Kpi label="Concluídas" value={dashboard.completedActions} />
        <Kpi label="Atrasadas" value={dashboard.overdueActions} tone="red" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="% Conclusão" value={formatPercent(dashboard.completionPct)} />
        <Kpi label="Horas planejadas" value={formatHours(dashboard.hours.planned)} />
        <Kpi label="Horas reais" value={formatHours(dashboard.hours.actual)} />
        <Kpi label="Variação" value={formatHours(dashboard.hours.variance)} tone={dashboard.hours.variance > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Indicadores mensais (planejado x real)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dashboard.monthlyTrend.map((m) => ({ ...m, monthLabel: formatMonthYear(m.month) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="monthLabel" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="plannedHours" name="Planejadas" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actualHours" name="Reais" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Ações por área/processo</h2>
          <ul className="space-y-2">
            {dashboard.byArea.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-sm cursor-pointer hover:text-blue-600" onClick={() => navigate(`/acoes?projectId=${id}&areaId=${a.id}`)}>
                <span>{a.name}</span>
                <span className="text-gray-500">{a.count} ações · {formatPercent(a.completionPct)} concluído</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Distribuição por status</h2>
          <ul className="space-y-2">
            {Object.entries(dashboard.byStatus).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-sm cursor-pointer hover:text-blue-600" onClick={() => navigate(`/acoes?projectId=${id}&status=${encodeURIComponent(status)}`)}>
                <span>{STATUS_META[status]?.label || status}</span>
                <span className="font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Carga por responsável</h2>
          <ul className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            {dashboard.workloadByResponsible.map((w) => (
              <li key={w.responsible} className="flex items-center justify-between text-sm cursor-pointer hover:text-blue-600" onClick={() => navigate(`/acoes?projectId=${id}&responsible=${encodeURIComponent(w.responsible)}`)}>
                <span>{w.responsible}</span>
                <span className="text-gray-500">{w.count} ações · {formatHours(w.actualHours)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {hasPermission(PERMISSIONS.AUDIT_VIEW) && (
        <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Atividade recente do projeto</h2>
          <ul className="space-y-2">
            {activity.map((ev) => (
              <li key={ev.id} className="text-xs border-b border-gray-50 pb-2">
                <span className="font-medium text-gray-700">{ev.actor_name}</span> — {ev.action_type}
                {ev.field_name ? ` · ${ev.field_name}` : ''} {ev.business_id ? `(ação #${ev.business_id})` : ''}
                <span className="text-gray-400"> · {formatDateTime(ev.created_at)}</span>
              </li>
            ))}
            {activity.length === 0 && <li className="text-xs text-gray-400">Nenhuma atividade recente.</li>}
          </ul>
        </div>
      )}

      <ActionFormModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={reload}
        defaultProjectId={id}
      />
    </div>
  );
}

function Kpi({ label, value, tone = 'default' }) {
  const toneClasses = { default: 'text-gray-900', red: 'text-red-700', green: 'text-green-700' };
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
