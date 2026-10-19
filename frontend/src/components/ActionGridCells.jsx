import { useState } from 'react';
import { formatDate, formatHours, formatMonthYear, toInputDate } from '../utils/format';
import { STATUSES, STATUS_META, GRID_STATUS_COLORS, pillStyle } from '../utils/constants';
import { AreaSelect, ResponsibleSelect } from './CatalogSelect';

/**
 * Inline editing for the Ações grid: clicking an editable cell swaps its text
 * for the matching field and saves the change straight away (Enter, leaving
 * the field, or picking an option); Esc cancels. Read-only cells keep opening
 * the action.
 */

const toInputMonth = (value) => toInputDate(value).slice(0, 7);
const today = () => new Date().toLocaleDateString('sv-SE');

function stop(e) { e.stopPropagation(); }

/** A <td> that shows `children` and, when clicked, the editor from `editor(done)`. */
function EditableCell({ canEdit, editor, className = '', title, children, minWidth }) {
  const [editing, setEditing] = useState(false);
  if (!canEdit) return <td className={className} title={title}>{children}</td>;
  if (editing) {
    return (
      <td className={`${className} dg-editing`} onClick={stop} style={minWidth ? { minWidth } : undefined}>
        {editor(() => setEditing(false))}
      </td>
    );
  }
  return (
    <td
      className={`${className} dg-editable`}
      title={title ? `${title}\n(clique para editar)` : 'Clique para editar'}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setEditing(true); } }}
      tabIndex={0}
    >
      {children}
    </td>
  );
}

/** Text/number/date/month field that saves on Enter or when it loses focus. */
function FieldEditor({ type = 'text', initial, onCommit, done, className = '', ...rest }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    if (busy) return;
    if (value === initial) { done(); return; }
    setBusy(true);
    const ok = await onCommit(value);
    setBusy(false);
    if (ok !== false) done();
  };
  return (
    <input
      autoFocus
      type={type}
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); done(); }
      }}
      className={`dg-input w-full ${className}`}
      {...rest}
    />
  );
}

/** Wraps a select so it saves on pick and closes on Esc or when left untouched. */
function SelectEditor({ done, children }) {
  return (
    <div
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) done(); }}
    >
      {children}
    </div>
  );
}

/**
 * Status select. Concluir asks for the completion date, cancelar for the
 * reason and reabrir a concluded action for why, like the action screen.
 */
function StatusEditor({ item, onSave, done }) {
  const [status, setStatus] = useState(item.status);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);

  const needs = (st) => {
    if (st === item.status) return null;
    if (st === 'CONCLUÍDO') return 'date';
    if (st === 'CANCELADO') return 'cancel';
    if (item.status === 'CONCLUÍDO') return 'reopen';
    return null;
  };
  const need = needs(status);

  const save = async (st, value) => {
    const kind = needs(st);
    const patch = { status: st };
    if (kind === 'date') patch.completionDate = value;
    if (kind === 'cancel') patch.cancellationReason = value.trim();
    // Leaving Concluído always needs a reason; cancelling reuses the cancel reason.
    if (kind === 'reopen' || (kind === 'cancel' && item.status === 'CONCLUÍDO')) patch.statusChangeReason = value.trim();
    setBusy(true);
    const ok = await onSave(patch);
    setBusy(false);
    if (ok !== false) done();
  };

  const pick = (st) => {
    setStatus(st);
    if (st === item.status) { done(); return; }
    const kind = needs(st);
    if (!kind) { save(st, ''); return; }
    setExtra(kind === 'date' ? toInputDate(item.completionDate) || today() : '');
  };

  const confirm = () => {
    if (!extra.trim()) return;
    save(status, extra);
  };

  return (
    <div onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } }} className="space-y-1">
      <select autoFocus value={status} disabled={busy} onChange={(e) => pick(e.target.value)} onBlur={(e) => { if (!need && !e.relatedTarget) done(); }} aria-label="Status" className="dg-input w-full">
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
      {need && (
        <>
          {need === 'date' ? (
            <input type="date" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Data de conclusão" title="Data de conclusão" className="dg-input w-full" />
          ) : (
            <input
              autoFocus
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
              placeholder={need === 'cancel' ? 'Motivo do cancelamento' : 'Motivo para reabrir'}
              aria-label={need === 'cancel' ? 'Motivo do cancelamento' : 'Motivo para reabrir'}
              className="dg-input w-full"
            />
          )}
          <div className="flex gap-1">
            <button type="button" onClick={confirm} disabled={busy || !extra.trim()} className="px-2 py-0.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Salvando...' : 'Salvar'}
            </button>
            <button type="button" onClick={done} className="px-2 py-0.5 rounded text-xs text-gray-300 hover:text-white">Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

export function ActionStatusPill({ status }) {
  const color = GRID_STATUS_COLORS[status];
  return (
    <span className="dg-pill" style={pillStyle(color)}>
      <span className="dg-dot" style={{ background: color }} aria-hidden="true" />
      {STATUS_META[status]?.label || status}
    </span>
  );
}

/**
 * The editable cells of one grid row, in column order. `save(patch)` sends the
 * change and resolves to false when it failed (the editor then stays open).
 */
export function ActionRowCells({ item, show, canEdit, save, catalogs, listsFor }) {
  const { projects, areas, people } = catalogs;
  const lists = listsFor(item.project.id);
  // The Prazo/Fim column shows the due date, or the completion date when there
  // is no due date; edit whichever one it shows.
  const endField = !item.dueDate && item.completionDate ? 'completionDate' : 'dueDate';

  return (
    <>
      {show('project') && (
        <EditableCell canEdit={canEdit} className="font-medium" minWidth="10rem" editor={(done) => (
          <SelectEditor done={done}>
            <select
              autoFocus
              value={String(item.project.id)}
              onChange={async (e) => { if ((await save({ projectId: Number(e.target.value) })) !== false) done(); }}
              aria-label="Projeto"
              className="dg-input w-full"
            >
              {!projects.some((p) => p.id === item.project.id) && <option value={item.project.id}>{item.project.name}</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </SelectEditor>
        )}>
          {item.project.name}
        </EditableCell>
      )}
      {show('refMonth') && (
        <EditableCell canEdit={canEdit} className="whitespace-nowrap" minWidth="9rem" editor={(done) => (
          <FieldEditor type="month" initial={toInputMonth(item.refMonth)} done={done} aria-label="Mês de referência"
            onCommit={(v) => (v ? save({ refMonth: v }) : false)} />
        )}>
          {formatMonthYear(item.refMonth)}
        </EditableCell>
      )}
      {show('area') && (
        <EditableCell canEdit={canEdit} minWidth="9rem" editor={(done) => (
          <SelectEditor done={done}>
            <AreaSelect
              autoFocus
              areas={areas}
              allowedIds={lists.areaIds}
              placeholder={false}
              value={String(item.area.id)}
              onChange={async (areaId) => { if ((await save({ areaId: Number(areaId) })) !== false) done(); }}
              aria-label="Área/Processo"
              className="dg-input w-full"
            />
          </SelectEditor>
        )}>
          {item.area.name}
        </EditableCell>
      )}
      {show('description') && (
        <EditableCell canEdit={canEdit} className="max-w-xs truncate" title={item.description} minWidth="16rem" editor={(done) => (
          <FieldEditor initial={item.description} done={done} aria-label="Descrição da ação"
            onCommit={(v) => (v.trim().length >= 3 ? save({ description: v.trim() }) : false)} />
        )}>
          {item.description}
        </EditableCell>
      )}
      {show('responsibleName') && (
        <EditableCell canEdit={canEdit} minWidth="9rem" editor={(done) => (
          <SelectEditor done={done}>
            <ResponsibleSelect
              autoFocus
              people={people}
              allowedIds={lists.personIds}
              value={item.responsibleName || ''}
              onChange={async (name) => {
                const patch = name ? { responsibleName: name } : { responsibleName: null, unassigned: true };
                if ((await save(patch)) !== false) done();
              }}
              aria-label="Responsável (vazio = sem responsável)"
              className="dg-input w-full"
            />
          </SelectEditor>
        )}>
          {item.responsibleName || <span className="warn text-xs">Sem responsável</span>}
        </EditableCell>
      )}
      {show('plannedHours') && (
        <EditableCell canEdit={canEdit} className="num" minWidth="6rem" editor={(done) => (
          <FieldEditor type="number" min="0" step="0.5" initial={item.plannedHours ? String(item.plannedHours) : ''} done={done}
            className="text-right" aria-label="Horas planejadas"
            onCommit={(v) => save({ plannedHours: v === '' ? null : Number(v) })} />
        )}>
          {formatHours(item.plannedHours)}
        </EditableCell>
      )}
      {show('actualHours') && <td className="num" title="Soma das horas lançadas na ação (abra a ação para lançar)">{formatHours(item.actualHours)}</td>}
      {show('varianceHours') && <td className={`num ${item.varianceHours > 0 ? 'danger' : ''}`} title="Calculada: horas reais − planejadas">{formatHours(item.varianceHours)}</td>}
      {show('startDate') && (
        <EditableCell canEdit={canEdit} className="whitespace-nowrap tabular-nums" minWidth="9rem" editor={(done) => (
          <FieldEditor type="date" initial={toInputDate(item.startDate)} done={done} aria-label="Data de início"
            onCommit={(v) => save({ startDate: v || null })} />
        )}>
          {formatDate(item.startDate)}
        </EditableCell>
      )}
      {show('dueDate') && (
        <EditableCell canEdit={canEdit} className={`whitespace-nowrap tabular-nums ${item.overdue ? 'danger' : ''}`} minWidth="9rem" editor={(done) => (
          <FieldEditor type="date" initial={toInputDate(item[endField])} done={done}
            aria-label={endField === 'dueDate' ? 'Prazo' : 'Data de conclusão'}
            onCommit={(v) => save({ [endField]: v || null })} />
        )}>
          {formatDate(item.dueDate || item.completionDate)}
        </EditableCell>
      )}
      {show('status') && (
        <EditableCell canEdit={canEdit} minWidth="10rem" editor={(done) => <StatusEditor item={item} onSave={save} done={done} />}>
          <ActionStatusPill status={item.status} />
        </EditableCell>
      )}
    </>
  );
}
