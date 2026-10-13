import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Loading, ErrorState } from '../components/Loading';

/** Editable catalogs used by the action form: responsáveis and áreas/processos. */
export default function CatalogLists() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Listas</h1>
      <p className="text-sm text-gray-500 mb-4">
        Itens inativos deixam de aparecer ao criar ações, mas continuam nas ações que já os usam.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CatalogPanel title="Responsáveis" endpoint="/people" itemLabel="responsável" />
        <CatalogPanel title="Áreas/Processos" endpoint="/areas" itemLabel="área/processo" />
      </div>
    </div>
  );
}

function CatalogPanel({ title, endpoint, itemLabel }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const load = () => {
    api.get(endpoint).then((d) => setItems(d.items || [])).catch((e) => setError(e.message));
  };
  useEffect(load, [endpoint]);

  const add = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post(endpoint, { name });
      toast.success(`${capitalize(itemLabel)} adicionado(a).`);
      setNewName('');
      load();
    } catch (err) { toast.error(err.message); }
  };

  const update = async (id, patch, message) => {
    try {
      await api.patch(`${endpoint}/${id}`, patch);
      toast.success(message);
      setEditingId(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const saveName = (item) => {
    const name = editName.trim();
    if (!name || name === item.name) { setEditingId(null); return; }
    update(item.id, { name }, 'Nome atualizado.');
  };

  const term = search.trim().toLowerCase();
  const visible = (items || []).filter((i) => !term || i.name.toLowerCase().includes(term));

  return (
    <section className="bg-white border border-[var(--color-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {items && <span className="text-xs text-gray-500">{items.filter((i) => i.active).length} ativos de {items.length}</span>}
      </div>

      <form onSubmit={add} className="flex gap-2 mb-3">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`Novo(a) ${itemLabel}`} aria-label={`Novo(a) ${itemLabel}`} className="input flex-1" />
        <button type="submit" disabled={!newName.trim()} className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Adicionar</button>
      </form>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." aria-label={`Buscar ${title.toLowerCase()}`} className="input mb-2" />

      {error && <ErrorState message={error} />}
      {!items && !error && <Loading />}
      {items && (
        <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {visible.length === 0 && <li className="py-3 text-sm text-gray-500">Nenhum item encontrado.</li>}
          {visible.map((item) => (
            <li key={item.id} className="py-2 flex items-center gap-2">
              {editingId === item.id ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveName(item); if (e.key === 'Escape') setEditingId(null); }}
                    aria-label="Novo nome"
                    className="input flex-1"
                  />
                  <button onClick={() => saveName(item)} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">Salvar</button>
                  <button onClick={() => setEditingId(null)} className="px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50">Cancelar</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${item.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{item.name}</span>
                  <button onClick={() => { setEditingId(item.id); setEditName(item.name); }} className="px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50">Editar</button>
                  <button
                    onClick={() => update(item.id, { active: !item.active }, item.active ? 'Item inativado.' : 'Item reativado.')}
                    className="px-2 py-1 rounded-md border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 w-20"
                  >
                    {item.active ? 'Inativar' : 'Reativar'}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
