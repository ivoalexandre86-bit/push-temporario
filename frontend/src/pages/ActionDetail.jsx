import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCatalogs } from '../hooks/useCatalogs';
import StatusChip from '../components/StatusChip';
import RewriteDescriptionModal from '../components/RewriteDescriptionModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { Loading, ErrorState } from '../components/Loading';
import { formatDate, formatDateTime, formatHours, formatPercent, toInputDate } from '../utils/format';
import { STATUSES, STATUS_META, FLAG_LABELS, IMPORT_EXCEPTION_LABELS, PERMISSIONS } from '../utils/constants';
import { validateActionDates } from '../utils/dateValidation';
import AuditValue from '../components/AuditValue';
import { auditActionLabel, auditFieldLabel } from '../utils/auditLabels';


export default function ActionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const { projects, areas } = useCatalogs();

  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // { type, payload }
  const [commentBody, setCommentBody] = useState('');
  const [timeEntryForm, setTimeEntryForm] = useState({ hours: '', type: 'ACTUAL', note: '' });
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editEntryForm, setEditEntryForm] = useState({ hours: '', type: 'ACTUAL', note: '' });
  const [savingEntryEdit, setSavingEntryEdit] = useState(false);
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false);
  const [dateErrors, setDateErrors] = useState({});
  // Date inputs whose browser value is incomplete/impossible (validity.badInput).
  const [badDates, setBadDates] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/actions/${id}`)
      .then((d) => { setAction(d); setEditForm(toEditForm(d)); setDateErrors({}); setBadDates([]); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!action) return null;

  const canEditAny = hasPermission(PERMISSIONS.ACTIONS_EDIT_ANY);
  const canEditAssigned = hasPermission(PERMISSIONS.ACTIONS_EDIT_ASSIGNED) && action.assignee?.id === user.id;
  const canEdit = canEditAny || canEditAssigned;
  const canDelete = hasPermission(PERMISSIONS.ACTIONS_DELETE);
  const canLogHours = hasPermission(PERMISSIONS.HOURS_EDIT) && (canEditAny || canEditAssigned);
  const canApproveHours = hasPermission(PERMISSIONS.HOURS_APPROVE);
  const canComment = hasPermission(PERMISSIONS.COMMENTS_CREATE);
  const canAttach = hasPermission(PERMISSIONS.ATTACHMENTS_CREATE);

  const changeDate = (key, e) => {
    const { value, validity } = e.target;
    setEditForm((f) => ({ ...f, [key]: value }));
    setBadDates((list) => (validity?.badInput ? [...new Set([...list, key])] : list.filter((k) => k !== key)));
    setDateErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  const applyPatch = async (patch, successMsg) => {
    setSaving(true);
    try {
      const updated = await api.patch(`/actions/${id}`, patch);
      setAction((prev) => ({ ...prev, ...updated }));
      setEditForm(toEditForm(updated));
      toast.success(successMsg || 'Ação atualizada com sucesso.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (editForm.startDate && editForm.dueDate && editForm.dueDate < editForm.startDate) {
      toast.error('O prazo não pode ser anterior à data de início.');
      return;
    }
    if (editForm.startDate && editForm.completionDate && editForm.completionDate < editForm.startDate) {
      toast.error('A data de conclusão não pode ser anterior à data de início.');
      return;
    }
    const patch = {};
    if (editForm.projectId !== String(action.project.id)) patch.projectId = Number(editForm.projectId);
    if (editForm.areaId !== String(action.area.id)) patch.areaId = Number(editForm.areaId);
    if (editForm.description !== action.description) patch.description = editForm.description;
    if (editForm.responsibleName !== (action.responsibleName || '')) patch.responsibleName = editForm.responsibleName || null;
    if (Number(editForm.plannedHours || 0) !== Number(action.plannedHours || 0)) patch.plannedHours = editForm.plannedHours ? Number(editForm.plannedHours) : null;
    if (editForm.startDate !== toInputDate(action.startDate)) patch.startDate = editForm.startDate || null;
    if (editForm.dueDate !== toInputDate(action.dueDate)) patch.dueDate = editForm.dueDate || null;
    if (editForm.completionDate !== toInputDate(action.completionDate)) patch.completionDate = editForm.completionDate || null;
    if (editForm.observations !== (action.observations || '')) patch.observations = editForm.observations || null;

    if (badDates.length || ['startDate', 'dueDate', 'completionDate'].some((k) => k in patch)) {
      const errs = validateActionDates(editForm, badDates);
      setDateErrors(errs);
      if (Object.keys(errs).length) { toast.error('Corrija as datas destacadas antes de salvar.'); return; }
    }

    if (Object.keys(patch).length === 0) { toast.info('Nenhuma alteração para salvar.'); return; }
    await applyPatch(patch, 'Alterações salvas.');
  };

  const handleStatusChange = (newStatus) => {
    if (newStatus === action.status) return;
    if (newStatus === 'CANCELADO') {
      setConfirm({ type: 'cancel', newStatus });
      return;
    }
    if (action.status === 'CONCLUÍDO' && newStatus !== 'CONCLUÍDO') {
      setConfirm({ type: 'reopen', newStatus });
      return;
    }
    if (newStatus === 'CONCLUÍDO' && !editForm.completionDate) {
      toast.error('Defina a data de conclusão antes de marcar como concluída.');
      return;
    }
    if (newStatus === 'CONCLUÍDO' && editForm.completionDate !== toInputDate(action.completionDate)) {
      // Save the (unsaved) completion date together with the status change.
      const errs = validateActionDates(editForm, badDates);
      setDateErrors(errs);
      if (Object.keys(errs).length) { toast.error('Corrija as datas destacadas antes de salvar.'); return; }
      applyPatch({ status: newStatus, completionDate: editForm.completionDate }, `Status alterado para ${STATUS_META[newStatus]?.label}.`);
      return;
    }
    applyPatch({ status: newStatus }, `Status alterado para ${STATUS_META[newStatus]?.label}.`);
  };

  const handleConfirm = (reason) => {
    if (!confirm) return;
    if (confirm.type === 'cancel') {
      applyPatch({ status: 'CANCELADO', cancellationReason: reason }, 'Ação cancelada.');
    } else if (confirm.type === 'reopen') {
      applyPatch({ status: confirm.newStatus, statusChangeReason: reason }, 'Status alterado.');
    } else if (confirm.type === 'delete') {
      api.del(`/actions/${id}`).then(() => { toast.success('Ação removida.'); navigate('/acoes'); }).catch((e) => toast.error(e.message));
    }
    setConfirm(null);
  };

  const submitComment = async (e) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    try {
      await api.post(`/actions/${id}/comments`, { body: commentBody.trim() });
      setCommentBody('');
      load();
    } catch (err) { toast.error(err.message); }
  };

  const submitTimeEntry = async (e) => {
    e.preventDefault();
    try {
      await api.post('/time-entries', {
        actionId: action.id,
        entryDate: new Date().toISOString().slice(0, 10),
        hours: Number(timeEntryForm.hours),
        type: timeEntryForm.type,
        note: timeEntryForm.note || null,
      });
      toast.success('Lançamento de horas registrado.');
      setTimeEntryForm({ hours: '', type: 'ACTUAL', note: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const approveEntry = async (entryId, approve) => {
    try {
      await api.patch(`/time-entries/${entryId}/approve`, { approve });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const startEditEntry = (entry) => {
    setEditingEntryId(entry.id);
    setEditEntryForm({ hours: String(entry.hours), type: entry.type, note: entry.note || '' });
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
  };

  const saveEditEntry = async (entryId) => {
    setSavingEntryEdit(true);
    try {
      await api.patch(`/time-entries/${entryId}`, {
        hours: Number(editEntryForm.hours),
        type: editEntryForm.type,
        note: editEntryForm.note || null,
      });
      toast.success('Lançamento de horas atualizado.');
      setEditingEntryId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEntryEdit(false);
    }
  };

  const handleAttachmentUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await api.postForm(`/actions/${id}/attachments`, formData);
      toast.success('Anexo enviado.');
      load();
    } catch (err) { toast.error(err.message); }
    e.target.value = '';
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <Link to="/acoes" className="hover:underline">Ações</Link>
        <span>/</span>
        <span>#{action.id}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ação #{action.id}</h1>
          <p className="text-sm text-gray-500">{action.project.name} · {action.area.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={action.status} />
          {canEdit && (
            <select
              value={action.status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="input !w-auto"
              aria-label="Alterar status"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          )}
          {canDelete && (
            <button onClick={() => setConfirm({ type: 'delete' })} className="px-3 py-1.5 rounded-md border border-red-300 text-red-600 text-sm hover:bg-red-50">Excluir</button>
          )}
        </div>
      </div>

      {(action.flags.length > 0 || action.importExceptions.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {action.flags.map((f) => (
            <span key={f} className="text-xs px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">⚠ {FLAG_LABELS[f] || f}</span>
          ))}
          {action.importExceptions.map((ex) => (
            <span key={ex} className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 border border-gray-200" title={IMPORT_EXCEPTION_LABELS[ex] || ex}>
              📥 {IMPORT_EXCEPTION_LABELS[ex] || ex}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Detalhes">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldView label="Projeto" editable={canEdit}>
                {canEdit ? (
                  <select value={editForm.projectId} onChange={(e) => setEditForm((f) => ({ ...f, projectId: e.target.value }))} className="input">
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : <p>{action.project.name}</p>}
              </FieldView>
              <FieldView label="Área/Processo" editable={canEdit}>
                {canEdit ? (
                  <select value={editForm.areaId} onChange={(e) => setEditForm((f) => ({ ...f, areaId: e.target.value }))} className="input">
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : <p>{action.area.name}</p>}
              </FieldView>
              <FieldView label="Mês de referência"><p>{formatDate(action.refMonth)}</p></FieldView>
              <FieldView label="Responsável" editable={canEdit}>
                {canEdit ? (
                  <input value={editForm.responsibleName} onChange={(e) => setEditForm((f) => ({ ...f, responsibleName: e.target.value }))} className="input" />
                ) : <p>{action.responsibleName || '—'}</p>}
              </FieldView>
            </div>
          </Section>

          <Section
            title="Descrição da ação"
            action={canEdit && (
              <button
                type="button"
                onClick={() => setRewriteModalOpen(true)}
                className="text-xs font-medium px-2 py-1 rounded-md border border-purple-300 text-purple-700 hover:bg-purple-50"
              >
                ✨ Revisão
              </button>
            )}
          >
            {canEdit ? (
              <textarea rows={5} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="input whitespace-pre-wrap" />
            ) : <p className="whitespace-pre-wrap text-sm text-gray-800">{action.description}</p>}
          </Section>

          <RewriteDescriptionModal
            open={rewriteModalOpen}
            onClose={() => setRewriteModalOpen(false)}
            actionId={id}
            originalText={editForm?.description || ''}
            onApply={(text) => setEditForm((f) => ({ ...f, description: text }))}
          />

          <Section title="Datas e prazos">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldView label="Início" editable={canEdit}>
                {canEdit ? <><input type="date" min={'1900-01-01'} max="2100-12-31" value={editForm.startDate} onChange={(e) => changeDate('startDate', e)} aria-invalid={!!dateErrors.startDate} className="input" />{dateErrors.startDate && <p role="alert" className="text-xs text-red-700 mt-1">{dateErrors.startDate}</p>}</> : <p>{formatDate(action.startDate)}</p>}
              </FieldView>
              <FieldView label="Prazo" editable={canEdit}>
                {canEdit ? <><input type="date" min={editForm.startDate || '1900-01-01'} max="2100-12-31" value={editForm.dueDate} onChange={(e) => changeDate('dueDate', e)} aria-invalid={!!dateErrors.dueDate} className="input" />{dateErrors.dueDate && <p role="alert" className="text-xs text-red-700 mt-1">{dateErrors.dueDate}</p>}</> : <p className={action.overdue ? 'text-red-600 font-semibold' : ''}>{formatDate(action.dueDate)}</p>}
              </FieldView>
              <FieldView label="Data de conclusão" editable={canEdit}>
                {canEdit ? <><input type="date" min={editForm.startDate || '1900-01-01'} max="2100-12-31" value={editForm.completionDate} onChange={(e) => changeDate('completionDate', e)} aria-invalid={!!dateErrors.completionDate} className="input" />{dateErrors.completionDate && <p role="alert" className="text-xs text-red-700 mt-1">{dateErrors.completionDate}</p>}</> : <p>{formatDate(action.completionDate)}</p>}
              </FieldView>
            </div>
          </Section>

          <Section title="Observações">
            {canEdit ? (
              <textarea rows={4} value={editForm.observations} onChange={(e) => setEditForm((f) => ({ ...f, observations: e.target.value }))} className="input whitespace-pre-wrap" />
            ) : <p className="whitespace-pre-wrap text-sm text-gray-800">{action.observations || '—'}</p>}
          </Section>

          {action.status === 'CANCELADO' && (
            <Section title="Motivo do cancelamento">
              <p className="text-sm text-gray-800">{action.cancellationReason || '—'}</p>
            </Section>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          )}

          <Section title="Horas">
            <div className="grid grid-cols-3 gap-4 mb-4 text-center">
              <div><p className="text-xs text-gray-500">Planejadas</p><p className="text-lg font-bold">{formatHours(action.plannedHours)}</p></div>
              <div><p className="text-xs text-gray-500">Reais</p><p className="text-lg font-bold">{formatHours(action.actualHours)}</p></div>
              <div><p className="text-xs text-gray-500">Variação</p><p className={`text-lg font-bold ${action.varianceHours > 0 ? 'text-red-600' : 'text-green-700'}`}>{formatHours(action.varianceHours)}</p></div>
            </div>
            {action.utilizationPct !== null && <p className="text-xs text-gray-500 mb-3">Utilização: {formatPercent(action.utilizationPct)}</p>}
            {action.actualHoursLegacy !== null && action.actualHoursLegacy !== undefined && (
              <p className="text-xs bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-3">
                Horas importadas da planilha original (legado): <strong>{formatHours(action.actualHoursLegacy)}</strong>
                {!action.legacyHoursConfirmed && ' — pendente de confirmação, não incluída no total até revisão.'}
              </p>
            )}

            {canLogHours && (
              <form onSubmit={submitTimeEntry} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end mb-4 border-t border-gray-100 pt-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Horas</label>
                  <input type="number" min="0" step="any" required value={timeEntryForm.hours} onChange={(e) => setTimeEntryForm((f) => ({ ...f, hours: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                  <select value={timeEntryForm.type} onChange={(e) => setTimeEntryForm((f) => ({ ...f, type: e.target.value }))} className="input">
                    <option value="ACTUAL">Real</option>
                    <option value="PLANNED">Planejado</option>
                  </select>
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nota</label>
                  <input value={timeEntryForm.note} onChange={(e) => setTimeEntryForm((f) => ({ ...f, note: e.target.value }))} className="input" />
                </div>
                <button type="submit" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 h-9">Lançar</button>
              </form>
            )}

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-1.5 pr-2 font-medium">Data</th>
                    <th className="py-1.5 pr-2 font-medium">Tipo</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Horas</th>
                    <th className="py-1.5 pr-2 font-medium">Nota</th>
                    <th className="py-1.5 pr-2 font-medium">Usuário</th>
                    <th className="py-1.5 pr-2 font-medium">Situação</th>
                    {(canLogHours || canApproveHours) && <th className="py-1.5 pr-2 font-medium">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {action.timeEntries.map((te) => {
                    const isEditing = editingEntryId === te.id;
                    if (isEditing) {
                      return (
                        <tr key={te.id} className="border-b border-gray-50 bg-blue-50/30">
                          <td className="py-1.5 pr-2">{formatDate(te.entry_date)}</td>
                          <td className="py-1.5 pr-2">
                            <select value={editEntryForm.type} onChange={(e) => setEditEntryForm((f) => ({ ...f, type: e.target.value }))} className="input !py-1 !w-auto text-sm">
                              <option value="ACTUAL">Real</option>
                              <option value="PLANNED">Planejado</option>
                            </select>
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <input type="number" min="0" step="any" value={editEntryForm.hours} onChange={(e) => setEditEntryForm((f) => ({ ...f, hours: e.target.value }))} className="input !py-1 !w-24 text-right" />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input value={editEntryForm.note} onChange={(e) => setEditEntryForm((f) => ({ ...f, note: e.target.value }))} className="input !py-1" />
                          </td>
                          <td className="py-1.5 pr-2">{te.user_name || '—'}</td>
                          <td className="py-1.5 pr-2">
                            <span className={`text-xs px-1.5 py-0.5 rounded ${te.approval_status === 'APPROVED' ? 'bg-green-50 text-green-700' : te.approval_status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                              {te.approval_status === 'APPROVED' ? 'Aprovado' : te.approval_status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="flex gap-2">
                              <button disabled={savingEntryEdit} onClick={() => saveEditEntry(te.id)} className="text-xs text-blue-700 hover:underline disabled:opacity-50">Salvar</button>
                              <button disabled={savingEntryEdit} onClick={cancelEditEntry} className="text-xs text-gray-500 hover:underline disabled:opacity-50">Cancelar</button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={te.id} className="border-b border-gray-50">
                        <td className="py-1.5 pr-2">{formatDate(te.entry_date)}</td>
                        <td className="py-1.5 pr-2">{te.type === 'ACTUAL' ? 'Real' : 'Planejado'}</td>
                        <td className={`py-1.5 pr-2 text-right ${te.hours < 0 ? 'text-red-600' : ''}`}>{formatHours(te.hours)}{te.is_legacy_import ? ' *' : ''}</td>
                        <td className="py-1.5 pr-2 text-gray-500">{te.note || '—'}</td>
                        <td className="py-1.5 pr-2">{te.user_name || '—'}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${te.approval_status === 'APPROVED' ? 'bg-green-50 text-green-700' : te.approval_status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                            {te.approval_status === 'APPROVED' ? 'Aprovado' : te.approval_status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                          </span>
                        </td>
                        {(canLogHours || canApproveHours) && (
                          <td className="py-1.5 pr-2">
                            <div className="flex gap-2 items-center">
                              {canLogHours && (
                                <button onClick={() => startEditEntry(te)} className="text-xs text-blue-700 hover:underline">Editar</button>
                              )}
                              {canApproveHours && te.approval_status === 'PENDING' && (
                                <>
                                  <button onClick={() => approveEntry(te.id, true)} className="text-xs text-green-700 hover:underline">Aprovar</button>
                                  <button onClick={() => approveEntry(te.id, false)} className="text-xs text-red-700 hover:underline">Rejeitar</button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {action.timeEntries.length === 0 && (
                    <tr><td colSpan={7} className="py-3 text-center text-gray-400">Nenhum lançamento de horas.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Anexos">
            {canAttach && (
              <div className="mb-3">
                <label className="inline-block px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                  Enviar arquivo
                  <input type="file" onChange={handleAttachmentUpload} className="hidden" />
                </label>
                <span className="text-xs text-gray-400 ml-2">PDF, imagens, planilhas e documentos — até 15MB</span>
              </div>
            )}
            <ul className="space-y-1">
              {action.attachments.map((att) => (
                <li key={att.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-md px-3 py-2">
                  <span className="truncate">{att.original_name}</span>
                  <a href={`${import.meta.env.VITE_API_URL || '/api'}/actions/${id}/attachments/${att.id}/download`} className="text-blue-600 text-xs hover:underline">Baixar</a>
                </li>
              ))}
              {action.attachments.length === 0 && <li className="text-sm text-gray-400">Nenhum anexo.</li>}
            </ul>
          </Section>

          <Section title="Comentários">
            {canComment && (
              <form onSubmit={submitComment} className="flex gap-2 mb-3">
                <input value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Adicionar um comentário..." className="input" />
                <button type="submit" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Enviar</button>
              </form>
            )}
            <ul className="space-y-3">
              {action.comments.map((c) => (
                <li key={c.id} className="text-sm border-b border-gray-50 pb-2">
                  <p className="text-gray-800">{c.body}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.author_name} · {formatDateTime(c.created_at)}</p>
                </li>
              ))}
              {action.comments.length === 0 && <li className="text-sm text-gray-400">Nenhum comentário.</li>}
            </ul>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Linha do tempo (auditoria)">
            <ol className="space-y-3 max-h-[32rem] overflow-y-auto scrollbar-thin">
              {action.timeline.map((ev) => (
                <li key={ev.id} className="text-xs border-l-2 border-gray-200 pl-3">
                  <p className="font-medium text-gray-800">
                    {auditActionLabel(ev.action_type)}{ev.field_name ? ` · ${auditFieldLabel(ev.field_name)}` : ''}
                  </p>
                  {ev.field_name && (ev.old_value !== null || ev.new_value !== null) && (
                    <div className="text-gray-600 mt-0.5 flex flex-wrap items-start gap-1">
                      <span>de</span> <AuditValue value={ev.old_value} field={ev.field_name} />
                      <span>para</span> <AuditValue value={ev.new_value} field={ev.field_name} />
                    </div>
                  )}
                  {!ev.field_name && ev.new_value && (
                    <div className="text-gray-600 mt-0.5"><AuditValue value={ev.new_value} /></div>
                  )}
                  <p className="text-gray-400 mt-0.5">{ev.actor_name} · {formatDateTime(ev.created_at)}</p>
                </li>
              ))}
              {action.timeline.length === 0 && <li className="text-xs text-gray-400">Sem histórico.</li>}
            </ol>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm && confirm.type === 'cancel'}
        title="Cancelar ação"
        description="Informe o motivo do cancelamento. Esta informação ficará registrada no histórico da ação."
        requireReason
        reasonLabel="Motivo do cancelamento"
        confirmLabel="Cancelar ação"
        danger
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={!!confirm && confirm.type === 'reopen'}
        title="Reabrir ação concluída"
        description="Esta ação está concluída. Informe o motivo para alterar o status."
        requireReason
        reasonLabel="Motivo"
        confirmLabel="Confirmar alteração"
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={!!confirm && confirm.type === 'delete'}
        title="Excluir ação"
        description={`Tem certeza que deseja excluir a ação #${action.id}? A ação será removida das listagens, mas o histórico de auditoria será preservado.`}
        confirmLabel="Excluir"
        danger
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function FieldView({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="text-sm text-gray-900">{children}</div>
    </div>
  );
}

function toEditForm(action) {
  return {
    projectId: String(action.project.id),
    areaId: String(action.area.id),
    description: action.description,
    responsibleName: action.responsibleName || '',
    plannedHours: action.plannedHours ?? '',
    startDate: toInputDate(action.startDate),
    dueDate: toInputDate(action.dueDate),
    completionDate: toInputDate(action.completionDate),
    observations: action.observations || '',
  };
}
