import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import ConfirmDialog from '../ConfirmDialog';
import { Loading, ErrorState } from '../Loading';
import RecordFormModal, { Field } from './RecordFormModal';

/** Create / rename a regional. */
export function RegionFormModal({ open, region, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(region?.name || ''); setNotes(region?.notes || ''); setError(''); }
  }, [open, region]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Informe o nome da regional.'); return; }
    setSaving(true); setError('');
    try {
      if (region) await api.patch(`/logistics/regions/${region.id}`, { name: name.trim(), notes: notes.trim() || null });
      else await api.post('/logistics/regions', { name: name.trim(), notes: notes.trim() || null });
      toast.success(region ? 'Regional atualizada.' : `Regional "${name.trim()}" cadastrada.`);
      onSaved?.();
      onClose();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="region-form-title" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 id="region-form-title" className="text-lg font-semibold text-gray-900 mb-4">{region ? 'Editar regional' : 'Nova regional'}</h2>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
          <Field label="Nome da regional *" htmlFor="region-name">
            <input id="region-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input" maxLength={200} />
          </Field>
          <Field label="Observações" htmlFor="region-notes">
            <textarea id="region-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" maxLength={4000} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Detalhe de uma regional: contatos por departamento (editáveis), filiais e
 * transportadores associados.
 */
export function RegionDetailModal({ regionId, onClose, onChanged, canManage, contactTarget, onShowBranches }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editContact, setEditContact] = useState(null); // {} = new
  const [deleting, setDeleting] = useState(null);
  const [editRegion, setEditRegion] = useState(false);

  const load = () => {
    setError('');
    api.get(`/logistics/regions/${regionId}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { if (regionId) { setData(null); load(); } }, [regionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!regionId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !editContact && !deleting && !editRegion) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [regionId, onClose, editContact, deleting, editRegion]);

  if (!regionId) return null;

  const changed = () => { load(); onChanged?.(); };

  const deleteContact = async () => {
    const c = deleting;
    setDeleting(null);
    try {
      await api.del(`/logistics/contacts/${c.id}`);
      toast.success('Contato excluído.');
      changed();
    } catch (e) { toast.error(e.message); }
  };

  const carriersByCompany = data ? [...new Set(data.carriers.map((c) => c.carrierName))].sort((a, b) => a.localeCompare(b, 'pt-BR')) : [];

  return (
    <div className="fixed inset-0 z-40 flex items-start sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="region-detail-title" className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-auto flex flex-col max-h-[calc(100vh-2rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-gray-500">Regional</p>
            <h2 id="region-detail-title" className="text-xl font-bold text-gray-900">{data?.name || '…'}</h2>
            {data?.notes && <p className="text-sm text-gray-600 mt-1">{data.notes}</p>}
          </div>
          <div className="flex items-center gap-2">
            {canManage && data && <button type="button" onClick={() => setEditRegion(true)} className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Editar</button>}
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-6">
          {error && <ErrorState message={error} onRetry={load} />}
          {!data && !error && <Loading />}
          {data && (
            <>
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">Contatos por departamento ({data.contacts.length})</h3>
                  {canManage && <button type="button" onClick={() => setEditContact({})} className="text-sm font-medium text-blue-700 hover:underline">+ Novo contato</button>}
                </div>
                {data.contacts.length === 0 ? <p className="text-sm text-gray-500">Nenhum contato cadastrado.</p> : (
                  <div className="border border-gray-200 rounded-lg overflow-x-auto scrollbar-thin">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-600">
                        <tr>
                          {['Departamento', 'Nome', 'E-mail', 'Tel. comercial', 'Canal de voz', 'Celular'].map((h) => <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
                          {canManage && <th className="px-3 py-2" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.contacts.map((c) => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{c.department}</td>
                            <td className="px-3 py-2 text-gray-800">{c.name || '—'}</td>
                            <td className="px-3 py-2">{c.email ? <a href={`mailto:${c.email}`} className="text-blue-700 hover:underline">{c.email}</a> : '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.phone || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.voiceChannel || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{c.mobile || '—'}</td>
                            {canManage && (
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <button type="button" onClick={() => setEditContact(c)} className="text-blue-700 text-xs font-medium hover:underline mr-3">Editar</button>
                                <button type="button" onClick={() => setDeleting(c)} className="text-red-700 text-xs font-medium hover:underline">Excluir</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">Filiais ({data.branches.length})</h3>
                  {data.branches.length > 0 && <button type="button" onClick={() => onShowBranches?.(data.id)} className="text-sm font-medium text-blue-700 hover:underline">Ver na aba Filiais</button>}
                </div>
                {data.branches.length === 0 ? <p className="text-sm text-gray-500">Nenhuma filial nesta regional.</p> : (
                  <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {data.branches.map((b) => (
                      <li key={b.id} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                        <span className="text-gray-800 truncate" title={b.branchName}>{b.branchName}</span>
                        <span className="text-gray-500 text-xs whitespace-nowrap">{[b.state, b.branchCode].filter(Boolean).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">Transportadores associados ({data.carriers.length} · {carriersByCompany.length} transportadora(s))</h3>
                  {data.carriers.length > 0 && <Link to={`/transportadores?regional=${data.id}`} className="text-sm font-medium text-blue-700 hover:underline">Ver em Transportadores</Link>}
                </div>
                {data.carriers.length === 0 ? <p className="text-sm text-gray-500">Nenhum transportador associado a esta regional.</p> : (
                  <div className="space-y-2">
                    {carriersByCompany.map((name) => {
                      const units = data.carriers.filter((c) => c.carrierName === name);
                      return (
                        <div key={name} className="border border-gray-200 rounded-lg px-3 py-2">
                          <p className="text-sm font-semibold text-gray-900">{name} <span className="font-normal text-gray-500">· {units.length} unidade(s)</span></p>
                          <p className="text-xs text-gray-600 mt-0.5">{units.map((u) => u.branchName || u.linkedBranchName || u.cnpj).join(' · ')}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      <RecordFormModal
        open={editContact !== null}
        target={contactTarget}
        record={editContact?.id ? editContact : null}
        defaultRegionId={regionId}
        fixedRegion
        onClose={() => setEditContact(null)}
        onSaved={changed}
      />
      <RegionFormModal open={editRegion} region={data} onClose={() => setEditRegion(false)} onSaved={changed} />
      <ConfirmDialog
        open={!!deleting}
        danger
        title="Excluir contato"
        description={deleting ? `Excluir o contato "${deleting.name || deleting.department}" (${deleting.department})? A exclusão fica registrada na auditoria.` : ''}
        confirmLabel="Excluir"
        onConfirm={deleteContact}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
