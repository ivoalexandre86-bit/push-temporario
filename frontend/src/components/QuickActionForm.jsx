import { useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useCatalogs } from '../hooks/useCatalogs';
import { useProjectLists, isOffered } from '../hooks/useProjectLists';
import { newActionDateDefaults } from '../utils/dateDefaults';
import { isValidRefMonth, validateActionDates } from '../utils/dateValidation';
import { STATUSES, STATUS_META } from '../utils/constants';
import { AreaSelect, ResponsibleSelect } from './CatalogSelect';

/**
 * Quick "nova ação" from an existing one. Starts with the source action's
 * project, área/processo and responsável, the usual new-action dates and
 * status Andamento; every field can be changed before saving.
 */
function useQuickCreate(source, onCreated) {
  const toast = useToast();
  const { projects, areas, people } = useCatalogs();
  const { listsFor } = useProjectLists(source.uuid);
  const [form, setForm] = useState(() => ({
    ...newActionDateDefaults(),
    projectId: String(source.project.id),
    areaId: String(source.area.id),
    description: '',
    responsibleName: source.responsibleName || '',
    plannedHours: '',
    status: 'ANDAMENTO',
    completionDate: '',
    cancellationReason: '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(''); };
  const lists = listsFor(form.projectId);
  // Switching project drops an área/responsável that the new project doesn't offer.
  const setProject = (projectId) => {
    const next = listsFor(projectId);
    const person = people.find((p) => p.name === form.responsibleName);
    set({
      projectId,
      areaId: isOffered(next.areaIds, form.areaId) ? form.areaId : '',
      responsibleName: !person || isOffered(next.personIds, person.id) ? form.responsibleName : '',
    });
  };

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (form.description.trim().length < 3) { setError('Descreva a ação com ao menos 3 caracteres.'); return; }
    if (!form.projectId || !form.areaId) { setError('Escolha o projeto e a área/processo.'); return; }
    if (!isValidRefMonth(form.refMonth)) { setError('Mês de referência inválido.'); return; }
    if (form.status === 'CONCLUÍDO' && !form.completionDate) { setError('Ações concluídas exigem a data de conclusão.'); return; }
    if (form.status === 'CANCELADO' && !form.cancellationReason.trim()) { setError('Informe o motivo do cancelamento.'); return; }
    const completionDate = form.status === 'CONCLUÍDO' ? form.completionDate : '';
    const dateErrors = validateActionDates({ startDate: form.startDate, dueDate: form.dueDate, completionDate });
    if (Object.keys(dateErrors).length) { setError(Object.values(dateErrors)[0]); return; }
    setSaving(true);
    try {
      const created = await api.post('/actions', {
        projectId: Number(form.projectId),
        areaId: Number(form.areaId),
        refMonth: form.refMonth,
        description: form.description.trim(),
        responsibleName: form.responsibleName || null,
        unassigned: !form.responsibleName,
        plannedHours: form.plannedHours === '' ? null : Number(form.plannedHours),
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        completionDate: completionDate || null,
        status: form.status,
        cancellationReason: form.status === 'CANCELADO' ? form.cancellationReason.trim() : null,
      });
      toast.success(`Ação #${created.id} criada.`);
      onCreated?.(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return { form, set, setProject, lists, projects, areas, people, saving, error, submit };
}

/** The status select plus the extra field a concluded/cancelled action needs. */
function StatusFields({ q, inputClass }) {
  return (
    <>
      <select value={q.form.status} onChange={(e) => q.set({ status: e.target.value })} aria-label="Status" className={inputClass}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
      {q.form.status === 'CONCLUÍDO' && (
        <input type="date" value={q.form.completionDate} onChange={(e) => q.set({ completionDate: e.target.value })} aria-label="Data de conclusão" title="Data de conclusão" className={`${inputClass} mt-1`} />
      )}
      {q.form.status === 'CANCELADO' && (
        <input value={q.form.cancellationReason} onChange={(e) => q.set({ cancellationReason: e.target.value })} placeholder="Motivo do cancelamento" aria-label="Motivo do cancelamento" className={`${inputClass} mt-1`} />
      )}
    </>
  );
}

/** The new action as one more row of the Ações grid, right under its source. */
export function QuickActionRow({ source, visibleCols, onCreated, onCancel }) {
  const q = useQuickCreate(source, onCreated);
  const show = (key) => visibleCols.includes(key);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') q.submit(e);
    if (e.key === 'Escape') onCancel();
  };
  const cls = 'dg-input w-full';
  return (
    <tr className="dg-quick" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
      {show('id') && <td className="muted text-xs">nova</td>}
      {show('project') && (
        <td style={{ minWidth: '10rem' }}>
          <select value={q.form.projectId} onChange={(e) => q.setProject(e.target.value)} aria-label="Projeto" className={cls}>
            {!q.projects.some((p) => String(p.id) === q.form.projectId) && <option value={q.form.projectId}>{source.project.name}</option>}
            {q.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </td>
      )}
      {show('refMonth') && (
        <td>
          <input type="month" value={q.form.refMonth} onChange={(e) => q.set({ refMonth: e.target.value })} aria-label="Mês de referência" className={cls} />
        </td>
      )}
      {show('area') && (
        <td style={{ minWidth: '9rem' }}>
          <AreaSelect areas={q.areas} allowedIds={q.lists.areaIds} value={q.form.areaId} onChange={(areaId) => q.set({ areaId })} aria-label="Área/Processo" className={cls} />
        </td>
      )}
      {show('description') && (
        <td style={{ minWidth: '16rem' }}>
          <input
            autoFocus
            value={q.form.description}
            onChange={(e) => q.set({ description: e.target.value })}
            placeholder="Descrição da nova ação"
            aria-label="Descrição da nova ação"
            aria-invalid={!!q.error}
            className={cls}
          />
          {q.error && <p role="alert" className="danger text-xs mt-1">{q.error}</p>}
        </td>
      )}
      {show('responsibleName') && (
        <td style={{ minWidth: '9rem' }}>
          <ResponsibleSelect people={q.people} allowedIds={q.lists.personIds} value={q.form.responsibleName} onChange={(responsibleName) => q.set({ responsibleName })} aria-label="Responsável (vazio = sem responsável)" title="Vazio = sem responsável" className={cls} />
        </td>
      )}
      {show('plannedHours') && (
        <td className="num" style={{ minWidth: '5rem' }}>
          <input type="number" min="0" step="0.5" value={q.form.plannedHours} onChange={(e) => q.set({ plannedHours: e.target.value })} placeholder="h" aria-label="Horas planejadas" className={`${cls} text-right`} />
        </td>
      )}
      {show('actualHours') && <td className="num muted">—</td>}
      {show('varianceHours') && <td className="num muted">—</td>}
      {show('startDate') && (
        <td>
          <input type="date" value={q.form.startDate} onChange={(e) => q.set({ startDate: e.target.value })} aria-label="Data de início" className={cls} />
        </td>
      )}
      {show('dueDate') && (
        <td>
          <input type="date" min={q.form.startDate || undefined} value={q.form.dueDate} onChange={(e) => q.set({ dueDate: e.target.value })} aria-label="Prazo" className={cls} />
        </td>
      )}
      {show('status') && <td style={{ minWidth: '8rem' }}><StatusFields q={q} inputClass={cls} /></td>}
      {show('updatedAt') && <td />}
      <td className="num whitespace-nowrap">
        {!show('description') && q.error && <p role="alert" className="danger text-xs mb-1">{q.error}</p>}
        <button type="button" onClick={q.submit} disabled={q.saving} className="px-2 py-1 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
          {q.saving ? 'Salvando...' : 'Criar ação'}
        </button>
        <button type="button" onClick={onCancel} className="dg-chevron ml-1" title="Cancelar" aria-label="Cancelar nova ação">✕</button>
      </td>
    </tr>
  );
}

/** Mobile version: the same fields stacked under the source action's card. */
export default function QuickActionForm({ source, onCreated, onCancel }) {
  const q = useQuickCreate(source, onCreated);
  const label = 'block text-xs font-medium text-gray-600 mb-0.5';
  return (
    <form onSubmit={q.submit} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} className="bg-white text-gray-900 rounded-lg p-3 space-y-2">
      <div>
        <label className={label}>Descrição *</label>
        <input autoFocus value={q.form.description} onChange={(e) => q.set({ description: e.target.value })} placeholder="Descrição da nova ação" aria-label="Descrição da nova ação" className="input" />
      </div>
      <div>
        <label className={label}>Projeto</label>
        <select value={q.form.projectId} onChange={(e) => q.setProject(e.target.value)} aria-label="Projeto" className="input">
          {!q.projects.some((p) => String(p.id) === q.form.projectId) && <option value={q.form.projectId}>{source.project.name}</option>}
          {q.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={label}>Mês de referência</label>
          <input type="month" value={q.form.refMonth} onChange={(e) => q.set({ refMonth: e.target.value })} aria-label="Mês de referência" className="input" />
        </div>
        <div>
          <label className={label}>Área/Processo</label>
          <AreaSelect areas={q.areas} allowedIds={q.lists.areaIds} value={q.form.areaId} onChange={(areaId) => q.set({ areaId })} aria-label="Área/Processo" />
        </div>
        <div>
          <label className={label}>Responsável</label>
          <ResponsibleSelect people={q.people} allowedIds={q.lists.personIds} value={q.form.responsibleName} onChange={(responsibleName) => q.set({ responsibleName })} aria-label="Responsável" />
        </div>
        <div>
          <label className={label}>Horas planejadas</label>
          <input type="number" min="0" step="0.5" value={q.form.plannedHours} onChange={(e) => q.set({ plannedHours: e.target.value })} aria-label="Horas planejadas" className="input" />
        </div>
        <div>
          <label className={label}>Início</label>
          <input type="date" value={q.form.startDate} onChange={(e) => q.set({ startDate: e.target.value })} aria-label="Data de início" className="input" />
        </div>
        <div>
          <label className={label}>Prazo</label>
          <input type="date" min={q.form.startDate || undefined} value={q.form.dueDate} onChange={(e) => q.set({ dueDate: e.target.value })} aria-label="Prazo" className="input" />
        </div>
      </div>
      <div>
        <label className={label}>Status</label>
        <StatusFields q={q} inputClass="input" />
      </div>
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
