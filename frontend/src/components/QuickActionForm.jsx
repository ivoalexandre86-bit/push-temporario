import { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { newActionDateDefaults } from '../utils/dateDefaults';
import { validateActionDates } from '../utils/dateValidation';
import { AreaSelect, ResponsibleSelect } from './CatalogSelect';

/**
 * Compact "nova ação" form shown right under an existing action in the grid.
 * The new action goes to the same project and starts with the same
 * área/processo and responsável; dates follow the usual new-action defaults.
 */
export default function QuickActionForm({ source, areas, people, onCreated, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    ...newActionDateDefaults(),
    description: '',
    areaId: String(source.area.id),
    responsibleName: source.responsibleName || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.description.trim().length < 3) { setError('Descreva a ação com ao menos 3 caracteres.'); return; }
    if (!form.areaId) { setError('Selecione a área/processo.'); return; }
    if (!form.refMonth) { setError('Informe o mês de referência.'); return; }
    const errs = validateActionDates({ startDate: form.startDate, dueDate: form.dueDate });
    if (Object.keys(errs).length) { setError(Object.values(errs)[0]); return; }
    if (form.startDate && form.dueDate && form.dueDate < form.startDate) { setError('A data fim não pode ser anterior à data de início.'); return; }
    setSaving(true);
    try {
      const created = await api.post('/actions', {
        projectId: source.project.id,
        areaId: Number(form.areaId),
        refMonth: form.refMonth,
        description: form.description.trim(),
        responsibleName: form.responsibleName || null,
        unassigned: !form.responsibleName,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        status: 'ANDAMENTO',
      });
      toast.success(`Ação #${created.id} criada.`);
      onCreated?.(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      className="bg-white text-gray-900 rounded-lg p-3 space-y-2"
    >
      <p className="text-xs text-gray-500">
        Nova ação em <span className="font-medium text-gray-700">{source.project.name}</span>, a partir da ação #{source.id}
      </p>
      <input
        autoFocus
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Descrição da nova ação"
        aria-label="Descrição da nova ação"
        className="input"
      />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <QuickField label="Área/Processo">
          <AreaSelect areas={areas} value={form.areaId} onChange={(areaId) => set({ areaId })} />
        </QuickField>
        <QuickField label="Responsável">
          <ResponsibleSelect people={people} value={form.responsibleName} onChange={(responsibleName) => set({ responsibleName })} />
        </QuickField>
        <QuickField label="Mês de referência">
          <input type="month" required value={form.refMonth} onChange={(e) => set({ refMonth: e.target.value })} className="input" />
        </QuickField>
        <QuickField label="Data de início">
          <input type="date" min="1900-01-01" max="2100-12-31" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className="input" />
        </QuickField>
        <QuickField label="Data fim (prazo)">
          <input type="date" min={form.startDate || '1900-01-01'} max="2100-12-31" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className="input" />
        </QuickField>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
          {saving ? 'Salvando...' : 'Criar ação'}
        </button>
      </div>
    </form>
  );
}

function QuickField({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
