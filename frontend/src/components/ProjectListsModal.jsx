import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Loading, ErrorState } from './Loading';

/**
 * Chooses which responsáveis and áreas/processos this project's action forms
 * offer. Leaving a list with nothing checked offers every active item.
 */
export default function ProjectListsModal({ open, projectId, onClose }) {
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [areas, setAreas] = useState(null);
  const [personIds, setPersonIds] = useState([]);
  const [areaIds, setAreaIds] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPeople(null);
    Promise.all([api.get('/people'), api.get('/areas'), api.get(`/projects/${projectId}/lists`)])
      .then(([pe, a, l]) => {
        setPeople(pe.items || []);
        setAreas(a.items || []);
        setPersonIds(l.personIds || []);
        setAreaIds(l.areaIds || []);
      })
      .catch((e) => setError(e.message));
  }, [open, projectId]);

  if (!open) return null;

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/projects/${projectId}/lists`, { personIds, areaIds });
      toast.success('Listas do projeto salvas.');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Listas do projeto</h2>
        <p className="text-sm text-gray-500 mb-4">
          Marque os responsáveis e as áreas/processos que aparecem ao criar ou editar ações deste projeto.
          Uma lista sem nada marcado mostra todos os itens ativos.
        </p>
        {error && <ErrorState message={error} />}
        {!people && !error && <Loading />}
        {people && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChecklistPanel title="Responsáveis" items={people} selected={personIds} onChange={setPersonIds} />
            <ChecklistPanel title="Áreas/Processos" items={areas} selected={areaIds} onChange={setAreaIds} />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={save} disabled={saving || !people} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistPanel({ title, items, selected, onChange }) {
  const [search, setSearch] = useState('');
  // Inactive items stay listed only while checked, so they can be unchecked.
  const offered = items.filter((i) => i.active || selected.includes(i.id));
  const term = search.trim().toLowerCase();
  const visible = offered.filter((i) => !term || i.name.toLowerCase().includes(term));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <section className="border border-[var(--color-border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
        <span className="text-xs text-gray-500">
          {selected.length ? `${selected.length} marcado(s)` : 'Todos'}
        </span>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." aria-label={`Buscar ${title.toLowerCase()}`} className="input mb-2" />
      <div className="flex gap-3 text-xs mb-1">
        <button type="button" onClick={() => onChange([...new Set([...selected, ...visible.map((i) => i.id)])])} className="text-blue-700 hover:underline">Marcar visíveis</button>
        <button type="button" onClick={() => onChange([])} className="text-blue-700 hover:underline">Limpar (mostrar todos)</button>
      </div>
      <ul className="max-h-[45vh] overflow-y-auto scrollbar-thin divide-y divide-gray-100">
        {visible.length === 0 && <li className="py-2 text-sm text-gray-500">Nenhum item encontrado.</li>}
        {visible.map((item) => (
          <li key={item.id}>
            <label className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="rounded border-gray-300 text-blue-600" />
              <span className={item.active ? 'text-gray-900' : 'text-gray-400 line-through'}>{item.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
