import { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { newActionDateDefaults } from '../utils/dateDefaults';
import { formatDate, formatMonthYear } from '../utils/format';
import { STATUS_META } from '../utils/constants';

/**
 * Quick "nova ação" from an existing one: same project, área/processo and
 * responsável as the source action, the usual new-action dates, status
 * Andamento. Only the description is typed.
 */
function useQuickCreate(source, onCreated) {
  const toast = useToast();
  const [defaults] = useState(() => newActionDateDefaults());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (description.trim().length < 3) { setError('Descreva a ação com ao menos 3 caracteres.'); return; }
    setSaving(true);
    try {
      const created = await api.post('/actions', {
        projectId: source.project.id,
        areaId: source.area.id,
        refMonth: defaults.refMonth,
        description: description.trim(),
        responsibleName: source.responsibleName || null,
        unassigned: !source.responsibleName,
        startDate: defaults.startDate,
        dueDate: defaults.dueDate,
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

  return { defaults, description, setDescription, saving, error, submit };
}

/** The new action as one more row of the Ações grid, right under its source. */
export function QuickActionRow({ source, visibleCols, onCreated, onCancel }) {
  const q = useQuickCreate(source, onCreated);
  const show = (key) => visibleCols.includes(key);
  const onKeyDown = (e) => {
    if (e.key === 'Enter') q.submit(e);
    if (e.key === 'Escape') onCancel();
  };
  return (
    <tr className="dg-quick" onClick={(e) => e.stopPropagation()}>
      {show('id') && <td className="muted text-xs">nova</td>}
      {show('project') && <td className="font-medium">{source.project.name}</td>}
      {show('refMonth') && <td className="whitespace-nowrap">{formatMonthYear(q.defaults.refMonth)}</td>}
      {show('area') && <td>{source.area.name}</td>}
      {show('description') && (
        <td style={{ minWidth: '16rem' }}>
          <input
            autoFocus
            value={q.description}
            onChange={(e) => q.setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Descrição da nova ação"
            aria-label="Descrição da nova ação"
            aria-invalid={!!q.error}
            className="dg-input w-full"
            style={{ borderColor: q.error ? '#f87171' : '#334155' }}
          />
          {q.error && <p role="alert" className="danger text-xs mt-1">{q.error}</p>}
        </td>
      )}
      {show('responsibleName') && <td>{source.responsibleName || <span className="warn text-xs">Sem responsável</span>}</td>}
      {show('plannedHours') && <td className="num muted">—</td>}
      {show('actualHours') && <td className="num muted">—</td>}
      {show('varianceHours') && <td className="num muted">—</td>}
      {show('startDate') && <td className="whitespace-nowrap tabular-nums">{formatDate(q.defaults.startDate)}</td>}
      {show('dueDate') && <td className="whitespace-nowrap tabular-nums">{formatDate(q.defaults.dueDate)}</td>}
      {show('status') && <td className="muted text-xs">{STATUS_META.ANDAMENTO.label}</td>}
      {show('updatedAt') && <td />}
      <td className="num whitespace-nowrap">
        <button type="button" onClick={q.submit} disabled={q.saving} className="px-2 py-1 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
          {q.saving ? 'Salvando...' : 'Criar ação'}
        </button>
        <button type="button" onClick={onCancel} className="dg-chevron ml-1" title="Cancelar" aria-label="Cancelar nova ação">✕</button>
      </td>
    </tr>
  );
}

/** Mobile version: one description field under the source action's card. */
export default function QuickActionForm({ source, onCreated, onCancel }) {
  const q = useQuickCreate(source, onCreated);
  return (
    <form onSubmit={q.submit} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} className="bg-white text-gray-900 rounded-lg p-3 space-y-2">
      <p className="text-xs text-gray-500">
        {source.project.name} · {source.area.name} · {source.responsibleName || 'Sem responsável'}
      </p>
      <input
        autoFocus
        value={q.description}
        onChange={(e) => q.setDescription(e.target.value)}
        placeholder="Descrição da nova ação"
        aria-label="Descrição da nova ação"
        className="input"
      />
      {q.error && <p role="alert" className="text-xs text-red-700">{q.error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
        <button type="submit" disabled={q.saving} className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
          {q.saving ? 'Salvando...' : 'Criar ação'}
        </button>
      </div>
    </form>
  );
}
