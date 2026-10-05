import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

/**
 * "Meus painéis" dropdown for the Dashboard: lets the user save the current
 * combination of filters under a name (reusing the saved_views table/API
 * that already backs the Ações screen's column preferences) and reopen it
 * later. Melhoria 8.
 */
export default function SavedViewsMenu({ filters, onApply }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  const load = () => api.get('/saved-views').then((d) => setViews(d.items || [])).catch(() => {});

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setShowSaveForm(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.post('/saved-views', { name: newName.trim(), filters });
      toast.success(`Painel "${newName.trim()}" salvo.`);
      setNewName('');
      setShowSaveForm(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (view) => {
    try {
      await api.del(`/saved-views/${view.id}`);
      toast.success(`Painel "${view.name}" removido.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
      >
        Meus painéis {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
            {views.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum painel salvo ainda.</p>}
            {views.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-1.5 py-1 text-sm hover:bg-gray-50 rounded-md mx-1">
                <button
                  type="button"
                  onClick={() => { onApply(v.filters); setOpen(false); }}
                  className="flex-1 text-left truncate text-gray-700 hover:text-blue-700 px-1.5 py-1"
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(v)}
                  className="text-gray-400 hover:text-red-600 text-xs px-1.5"
                  aria-label={`Excluir painel ${v.name}`}
                  title="Excluir"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 p-2">
            {!showSaveForm ? (
              <button
                type="button"
                onClick={() => setShowSaveForm(true)}
                className="w-full text-left text-sm text-blue-700 hover:underline px-1.5 py-1"
              >
                + Salvar filtros atuais como painel
              </button>
            ) : (
              <form onSubmit={handleSave} className="flex gap-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome do painel"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button type="submit" disabled={saving || !newName.trim()} className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60">
                  Salvar
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
