import { useEffect, useState } from 'react';
import { useCatalogs } from '../hooks/useCatalogs';
import { STATUSES, STATUS_META } from '../utils/constants';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { isValidRefMonth, validateActionDates } from '../utils/dateValidation';

export default function ActionFormModal({ open, onClose, onCreated, defaultProjectId }) {
  const { projects, areas } = useCatalogs();
  const toast = useToast();
  const [form, setForm] = useState(() => emptyForm(defaultProjectId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dateErrors, setDateErrors] = useState({});
  // Date inputs whose browser value is incomplete/impossible (validity.badInput).
  const [badDates, setBadDates] = useState([]);

  // Reset the form (picking up the current default project) every time the
  // modal is opened, so a project the user is "inside of" is always applied.
  useEffect(() => {
    if (open) {
      setForm(emptyForm(defaultProjectId));
      setDateErrors({});
      setBadDates([]);
    }
  }, [open, defaultProjectId]);

  if (!open) return null;

  const projectLocked = Boolean(defaultProjectId);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setDate = (key, e) => {
    const { value, validity } = e.target;
    set({ [key]: value });
    setBadDates((list) => (validity?.badInput ? [...new Set([...list, key])] : list.filter((k) => k !== key)));
    setDateErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.projectId || !form.areaId || !form.refMonth || !form.description || !form.status) {
      setError('Preencha projeto, área, mês de referência, descrição e status.');
      return;
    }
    if (!form.responsibleName && !form.unassigned) {
      setError('Informe um responsável ou marque "sem responsável".');
      return;
    }
    if (form.status === 'CONCLUÍDO' && !form.completionDate) {
      setError('Ações concluídas exigem a data de conclusão.');
      return;
    }
    if (form.status === 'CANCELADO' && !form.cancellationReason) {
      setError('Informe o motivo do cancelamento.');
      return;
    }
    if (!isValidRefMonth(form.refMonth)) {
      setError('Mês de referência inválido: use o formato mm/aaaa.');
      return;
    }
    const completionDate = form.status === 'CONCLUÍDO' ? form.completionDate : '';
    const errs = validateActionDates({ startDate: form.startDate, dueDate: form.dueDate, completionDate }, badDates);
    setDateErrors(errs);
    if (Object.keys(errs).length) {
      setError('Corrija as datas destacadas antes de salvar.');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post('/actions', {
        projectId: Number(form.projectId),
        areaId: Number(form.areaId),
        refMonth: form.refMonth,
        description: form.description,
        responsibleName: form.unassigned ? null : (form.responsibleName || null),
        unassigned: form.unassigned,
        plannedHours: form.plannedHours ? Number(form.plannedHours) : null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        completionDate: completionDate || null,
        status: form.status,
        observations: form.observations || null,
        cancellationReason: form.cancellationReason || null,
      });
      toast.success(`Ação #${created.id} criada com sucesso.`);
      setForm(emptyForm(defaultProjectId));
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nova ação</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Projeto *">
              <select required value={form.projectId} disabled={projectLocked} onChange={(e) => set({ projectId: e.target.value })} className="input disabled:bg-gray-100">
                <option value="">Selecione...</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {projectLocked && <p className="text-xs text-gray-400 mt-1">Vinculado automaticamente ao projeto atual.</p>}
            </Field>
            <Field label="Área/Processo *">
              <select required value={form.areaId} onChange={(e) => set({ areaId: e.target.value })} className="input">
                <option value="">Selecione...</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Mês de referência *">
              <input type="month" required value={form.refMonth} onChange={(e) => set({ refMonth: e.target.value })} className="input" />
            </Field>
            <Field label="Status *">
              <select required value={form.status} onChange={(e) => set({ status: e.target.value })} className="input">
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Descrição da ação *">
            <textarea required rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} className="input" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Responsável">
              <input value={form.responsibleName} disabled={form.unassigned} onChange={(e) => set({ responsibleName: e.target.value })} className="input disabled:bg-gray-100" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
              <input type="checkbox" checked={form.unassigned} onChange={(e) => set({ unassigned: e.target.checked, responsibleName: '' })} className="rounded border-gray-300 text-blue-600" />
              Sem responsável definido
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Horas planejadas">
              <input type="number" min="0" step="0.5" value={form.plannedHours} onChange={(e) => set({ plannedHours: e.target.value })} className="input" />
            </Field>
            <Field label="Data de início">
              <input type="date" min="1900-01-01" max="2100-12-31" value={form.startDate} onChange={(e) => setDate('startDate', e)} aria-invalid={!!dateErrors.startDate} className="input" />
              <FieldError message={dateErrors.startDate} />
            </Field>
            <Field label="Prazo">
              <input type="date" min={form.startDate || '1900-01-01'} max="2100-12-31" value={form.dueDate} onChange={(e) => setDate('dueDate', e)} aria-invalid={!!dateErrors.dueDate} className="input" />
              <FieldError message={dateErrors.dueDate} />
            </Field>
          </div>

          {form.status === 'CONCLUÍDO' && (
            <Field label="Data de conclusão *">
              <input type="date" required min={form.startDate || '1900-01-01'} max="2100-12-31" value={form.completionDate} onChange={(e) => setDate('completionDate', e)} aria-invalid={!!dateErrors.completionDate} className="input" />
              <FieldError message={dateErrors.completionDate} />
            </Field>
          )}
          {form.status === 'CANCELADO' && (
            <Field label="Motivo do cancelamento *">
              <textarea required rows={2} value={form.cancellationReason} onChange={(e) => set({ cancellationReason: e.target.value })} className="input" />
            </Field>
          )}

          <Field label="Observações">
            <textarea rows={3} value={form.observations} onChange={(e) => set({ observations: e.target.value })} className="input" />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Salvando...' : 'Criar ação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="text-xs text-red-700 mt-1">{message}</p>;
}

function emptyForm(defaultProjectId) {
  return {
    projectId: defaultProjectId || '', areaId: '', refMonth: '', description: '',
    responsibleName: '', unassigned: false, plannedHours: '', startDate: '', dueDate: '',
    completionDate: '', status: 'ANDAMENTO', observations: '', cancellationReason: '',
  };
}
