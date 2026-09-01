import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import ProjectFormModal from '../components/ProjectFormModal';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../utils/constants';

export default function ProjectsList() {
  const { hasPermission } = useAuth();
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  const reload = () => api.get('/projects').then((d) => setProjects(d.items)).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!projects) return <Loading />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Projetos</h1>
        {hasPermission(PERMISSIONS.PROJECTS_MANAGE) && (
          <button onClick={() => setShowNew(true)} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            + Novo projeto
          </button>
        )}
      </div>
      {projects.length === 0 ? (
        <EmptyState title="Nenhum projeto disponível" description="Você ainda não tem acesso a nenhum projeto." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/projetos/${p.id}`} className="bg-white border border-[var(--color-border)] rounded-xl p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-2">
                <h2 className="font-semibold text-gray-900">{p.name}</h2>
                {!p.active && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">Inativo</span>}
              </div>
              {p.description && <p className="text-sm text-gray-500 mb-2 line-clamp-2">{p.description}</p>}
              <p className="text-xs text-gray-400">{p.action_count} ações · Gerente: {p.manager_name || 'não definido'}</p>
            </Link>
          ))}
        </div>
      )}

      <ProjectFormModal open={showNew} onClose={() => setShowNew(false)} onCreated={reload} />
    </div>
  );
}
