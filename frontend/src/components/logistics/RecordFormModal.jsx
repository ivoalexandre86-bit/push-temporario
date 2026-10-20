import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { groupFields, UFS, validateFields } from './logistics';

const UNIT_KEYS = ['complex', 'state', 'company', 'branchCode', 'branchName', 'cnpj', 'address', 'zipCode'];

const ENDPOINTS = {
  BRANCHES: { create: () => '/logistics/branches', update: (id) => `/logistics/branches/${id}`, noun: 'filial', title: ['Nova filial', 'Editar filial'] },
  CARRIERS: { create: () => '/logistics/carriers', update: (id) => `/logistics/carriers/${id}`, noun: 'transportador', title: ['Novo transportador', 'Editar transportador'] },
  REGIONS: { create: (regionId) => `/logistics/regions/${regionId}/contacts`, update: (id) => `/logistics/contacts/${id}`, noun: 'contato', title: ['Novo contato', 'Editar contato'] },
};

/**
 * Create / edit form for a filial, transportador or contato de regional,
 * generated from the field catalog (same fields as the spreadsheet). The
 * same rules as the API are checked before sending.
 */
export default function RecordFormModal({
  open, onClose, onSaved, target, record, regions = [], branches = [], defaultRegionId, carrierNames = [], fixedRegion = false,
}) {
  const toast = useToast();
  const isEdit = Boolean(record?.id);
  const targetKey = target?.key;
  const ep = ENDPOINTS[targetKey];
  const fields = useMemo(() => (target ? target.fields.filter((f) => f.key !== 'region') : []), [target]);
  // Identification rules (same as the API): the only required fields.
  const requiredFields = useMemo(() => fields.map((f) => ({
    ...f,
    required: (targetKey === 'BRANCHES' && f.key === 'branchName') || (targetKey === 'CARRIERS' && f.key === 'carrierName') || (targetKey === 'REGIONS' && f.key === 'department'),
  })), [fields, targetKey]);

  const initial = useMemo(() => {
    const base = Object.fromEntries(fields.map((f) => [f.key, record?.[f.key] ?? '']));
    return { ...base, regionId: String(record?.regionId ?? defaultRegionId ?? ''), branchId: String(record?.branchId ?? '') };
  }, [record, fields, defaultRegionId]);

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm(initial); setErrors({}); setError(''); }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !target) return null;

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }));
  };

  const regionBranches = branches.filter((b) => String(b.regionId) === String(form.regionId));

  const chooseBranch = (branchId) => {
    const b = branches.find((x) => String(x.id) === String(branchId));
    if (!b) { set({ branchId: '' }); return; }
    set({ branchId: String(b.id), ...Object.fromEntries(UNIT_KEYS.map((k) => [k, b[k] ?? ''])) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const errs = validateFields(requiredFields, form, initial);
    if (!fixedRegion && !form.regionId) errs.regionId = 'Selecione a regional.';
    if (targetKey === 'CARRIERS' && !form.branchId && !String(form.branchName).trim() && !String(form.cnpj).trim()) {
      errs.branchName = 'Selecione a filial atendida ou preencha o nome/CNPJ da unidade.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) { setError('Corrija os campos destacados.'); return; }

    const body = {};
    for (const f of fields) {
      const v = String(form[f.key] ?? '').trim();
      if (!isEdit ? v : v !== String(initial[f.key] ?? '').trim()) body[f.key] = v || null;
    }
    if (!fixedRegion && (!isEdit || form.regionId !== initial.regionId)) body.regionId = Number(form.regionId);
    if (targetKey === 'CARRIERS' && (!isEdit || form.branchId !== initial.branchId)) body.branchId = form.branchId ? Number(form.branchId) : null;
    if (isEdit && Object.keys(body).length === 0) { onClose(); return; }

    setSaving(true);
    try {
      if (isEdit) await api.patch(ep.update(record.id), body);
      else await api.post(ep.create(form.regionId || defaultRegionId), body);
      toast.success(isEdit ? `Cadastro de ${ep.noun} atualizado.` : `${ep.noun[0].toUpperCase()}${ep.noun.slice(1)} cadastrado(a) com sucesso.`);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
      const details = Array.isArray(err.details) ? err.details : [];
      setErrors(Object.fromEntries(details.filter((d) => d.path).map((d) => [d.path, d.message])));
    } finally {
      setSaving(false);
    }
  };

  const groups = groupFields(requiredFields);

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4 sm:py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="record-form-title" className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-auto flex flex-col max-h-[calc(100vh-2rem)]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 id="record-form-title" className="text-lg font-semibold text-gray-900">{ep.title[isEdit ? 1 : 0]}</h2>
          {isEdit && record.source === 'IMPORT' && <p className="text-xs text-gray-500 mt-0.5">Registro importado da planilha. Valores fora do padrão vindos da planilha são mantidos até você alterá-los.</p>}
        </div>
        <form onSubmit={handleSubmit} noValidate className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
            {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

            {!fixedRegion && (
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Regional *" htmlFor="rf-region" error={errors.regionId}>
                  <select id="rf-region" value={form.regionId} onChange={(e) => set({ regionId: e.target.value, branchId: '' })} className="input" aria-invalid={!!errors.regionId}>
                    <option value="">Selecione...</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                {targetKey === 'CARRIERS' && (
                  <Field label="Filial atendida" htmlFor="rf-branch" error={errors.branchId} hint="Ao escolher, os dados da unidade são preenchidos a partir do cadastro de filiais.">
                    <select id="rf-branch" value={form.branchId} onChange={(e) => chooseBranch(e.target.value)} className="input" disabled={!form.regionId}>
                      <option value="">— Unidade sem cadastro de filial —</option>
                      {regionBranches.map((b) => <option key={b.id} value={b.id}>{b.branchName}{b.branchCode ? ` (${b.branchCode})` : ''}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}

            {groups.map((g) => (
              <fieldset key={g.name} className="border border-gray-200 rounded-lg px-3 sm:px-4 pt-2 pb-3">
                <legend className="px-1 text-sm font-semibold text-gray-700">{g.name}</legend>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {g.fields.map((f) => {
                    const id = `rf-${f.key}`;
                    const shortLabel = f.label.includes(' — ') ? f.label.split(' — ')[1] : f.label;
                    const wide = f.key === 'address' || f.key === 'notes' || f.key === 'branchName';
                    return (
                      <div key={f.key} className={wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
                        <Field label={`${shortLabel}${f.required ? ' *' : ''}`} htmlFor={id} error={errors[f.key]}>
                          {f.key === 'notes' ? (
                            <textarea id={id} rows={2} value={form[f.key]} onChange={(e) => set({ [f.key]: e.target.value })} className="input" maxLength={4000} />
                          ) : (
                            <input
                              id={id}
                              value={form[f.key]}
                              onChange={(e) => set({ [f.key]: f.kind === 'uf' ? e.target.value.toUpperCase() : e.target.value })}
                              className="input"
                              aria-invalid={!!errors[f.key]}
                              type={f.kind === 'email' ? 'text' : 'text'}
                              inputMode={f.kind === 'phone' ? 'tel' : f.kind === 'zip' ? 'numeric' : f.kind === 'email' ? 'email' : undefined}
                              list={f.kind === 'uf' ? 'rf-ufs' : f.key === 'carrierName' ? 'rf-carriers' : undefined}
                              maxLength={f.kind === 'uf' ? 2 : 4000}
                              placeholder={f.kind === 'cnpj' ? '00.000.000/0000-00' : f.kind === 'zip' ? '00000-000' : undefined}
                            />
                          )}
                        </Field>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <datalist id="rf-ufs">{UFS.map((u) => <option key={u} value={u} />)}</datalist>
            <datalist id="rf-carriers">{carrierNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="flex justify-end gap-2 px-5 sm:px-6 py-3 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}
