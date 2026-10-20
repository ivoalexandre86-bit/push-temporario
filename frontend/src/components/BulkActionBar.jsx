import { useState } from 'react';
import { api } from '../api/client';
import { STATUSES, STATUS_META } from '../utils/constants';
import { ResponsibleSelect } from './CatalogSelect';

/**
 * Bar shown above the Ações grid while actions are checked: pick a field,
 * a new value and "Aplicar" to update every checked action at once. Each
 * action is saved with the same PATCH as the inline edit, so permissions,
 * validations and the audit trail stay the same.
 */

const FIELDS = [
  { key: 'status', label: 'Status' },
  { key: 'responsibleName', label: 'Responsável' },
  { key: 'dueDate', label: 'Prazo' },
  { key: 'refMonth', label: 'Mês de referência' },
];

const today = () => new Date().toLocaleDateString('sv-SE');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The PATCH body for one action, or null when it already has the value. */
function bulkPatchFor(item, field, value, extra) {
  if (field === 'status') {
    if (item.status === value) return null;
    const patch = { status: value };
    if (value === 'CONCLUÍDO') patch.completionDate = extra.completionDate;
    if (value === 'CANCELADO') patch.cancellationReason = extra.reason.trim();
    // Leaving Concluído always needs a reason; cancelling reuses the cancel reason.
    if (item.status === 'CONCLUÍDO') patch.statusChangeReason = extra.reason.trim();
    return patch;
  }
  if (field === 'responsibleName') {
    if ((item.responsibleName || '') === value) return null;
    return value ? { responsibleName: value } : { responsibleName: null, unassigned: true };
  }
  if (field === 'dueDate') return { dueDate: value || null };
  if (field === 'refMonth') return { refMonth: value };
  return null;
}

export default function BulkActionBar({ selected, people, onClear, onDone }) {
  const [field, setField] = useState('status');
  const [value, setValue] = useState('CONCLUÍDO');
  const [completionDate, setCompletionDate] = useState(today());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const items = [...selected.values()];
  const reopening = field === 'status' && value !== 'CONCLUÍDO' && items.some((it) => it.status === 'CONCLUÍDO');
  const needsReason = field === 'status' && (value === 'CANCELADO' || reopening);
  const needsDate = field === 'status' && value === 'CONCLUÍDO';
  const missing = (field === 'refMonth' && !value)
    || (needsDate && !completionDate)
    || (needsReason && !reason.trim());

  const changeField = (f) => {
    setField(f);
    setValue(f === 'status' ? 'CONCLUÍDO' : '');
    setResult(null);
  };

  const apply = async () => {
    if (busy || missing) return;
    setBusy(true);
    setProgress(0);
    setResult(null);
    const extra = { completionDate, reason };
    const errors = [];
    let updated = 0;
    let unchanged = 0;
    // One at a time keeps the order of the audit entries and spares the server.
    for (const item of items) {
      const patch = bulkPatchFor(item, field, value, extra);
      if (!patch) unchanged += 1;
      else {
        try {
          await api.patch(`/actions/${item.id}`, patch);
          updated += 1;
        } catch (err) {
          errors.push({ id: item.id, message: err.message });
        }
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    setResult({ updated, unchanged, errors });
    onDone({ updated, unchanged, errors });
  };

  return (
    <div className="bulk-bar mb-3" role="region" aria-label="Atualização em massa">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-sm">{plural(items.length, 'ação selecionada', 'ações selecionadas')}</span>
        <span className="text-sm opacity-70">· Alterar</span>
        <select value={field} onChange={(e) => changeField(e.target.value)} disabled={busy} aria-label="Campo a alterar" className="input !w-auto py-1">
          {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <span className="text-sm opacity-70">para</span>

        {field === 'status' && (
          <select value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} aria-label="Novo status" className="input !w-auto py-1">
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        )}
        {field === 'responsibleName' && (
          <ResponsibleSelect people={people} value={value} onChange={setValue} disabled={busy}
            aria-label="Novo responsável (vazio = sem responsável)" className="input !w-auto py-1" />
        )}
        {field === 'dueDate' && (
          <input type="date" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
            aria-label="Novo prazo (vazio = sem prazo)" className="input !w-auto py-1" />
        )}
        {field === 'refMonth' && (
          <input type="month" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}
            aria-label="Novo mês de referência" className="input !w-auto py-1" />
        )}

        {needsDate && (
          <label className="flex items-center gap-1 text-sm">
            <span className="opacity-70">Data de conclusão</span>
            <input type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} disabled={busy} className="input !w-auto py-1" />
          </label>
        )}
        {needsReason && (
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
            disabled={busy}
            placeholder={value === 'CANCELADO' ? 'Motivo do cancelamento' : 'Motivo para reabrir as concluídas'}
            aria-label={value === 'CANCELADO' ? 'Motivo do cancelamento' : 'Motivo para reabrir as concluídas'}
            className="input !w-auto py-1 min-w-[14rem]"
          />
        )}

        <button type="button" onClick={apply} disabled={busy || missing}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {busy ? `Aplicando ${progress}/${items.length}...` : `Aplicar em ${plural(items.length, 'ação', 'ações')}`}
        </button>
        <button type="button" onClick={onClear} disabled={busy}
          className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
          Limpar seleção
        </button>
      </div>
      {result && result.errors.length > 0 && (
        <ul className="mt-2 text-sm text-red-600 space-y-0.5">
          {result.errors.map((e) => <li key={e.id}>Ação #{e.id}: {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}
