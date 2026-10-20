// Shared helpers for the Regionais / Filiais / Transportadores screens:
// field catalog (from the API, single source of truth), client-side
// validation mirroring the backend, and small formatting helpers.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

let fieldsCache = null;
let fieldsPromise = null;

/** Loads /logistics/fields once per session. Returns { targets, byKey, error }. */
export function useLogisticsFields() {
  const [state, setState] = useState(() => (fieldsCache ? { ...fieldsCache, error: '' } : { targets: null, byKey: {}, error: '' }));
  useEffect(() => {
    if (fieldsCache) return;
    fieldsPromise = fieldsPromise || api.get('/logistics/fields').then((d) => {
      fieldsCache = { targets: d.targets, byKey: Object.fromEntries(d.targets.map((t) => [t.key, t])), defaultOptions: d.defaultOptions };
      return fieldsCache;
    });
    fieldsPromise
      .then((c) => setState({ ...c, error: '' }))
      .catch((e) => { fieldsPromise = null; setState((s) => ({ ...s, error: e.message })); });
  }, []);
  return state;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const digits = (v) => String(v ?? '').replace(/\D+/g, '');

export function isValidCnpj(value) {
  const d = digits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = w.reduce((acc, x, i) => acc + Number(d[i]) * x, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Validates the form fields whose value changed (same rule as the API:
 * values imported "as is" from the spreadsheet don't block editing other fields).
 * Returns { fieldKey: message }.
 */
export function validateFields(fields, form, initial = {}) {
  const errors = {};
  for (const f of fields) {
    const v = String(form[f.key] ?? '').trim();
    if (f.required && !v) errors[f.key] = `Informe ${f.label.toLowerCase()}.`;
    if (!v || v === String(initial[f.key] ?? '').trim()) continue;
    if (f.kind === 'cnpj' && !isValidCnpj(v)) errors[f.key] = 'CNPJ inválido.';
    if (f.kind === 'uf' && !UFS.includes(v.toUpperCase())) errors[f.key] = 'UF inválida.';
    if (f.kind === 'zip' && digits(v).length !== 8) errors[f.key] = 'O CEP deve ter 8 dígitos.';
    if (f.kind === 'email' && v.split(/\s*(?:\/|;|,|\se\s)\s*/i).filter(Boolean).some((p) => !isEmail(p))) errors[f.key] = 'E-mail inválido.';
  }
  return errors;
}

/** Groups fields by `group`, keeping catalog order. */
export function groupFields(fields) {
  const groups = [];
  for (const f of fields) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) { g = { name: f.group, fields: [] }; groups.push(g); }
    g.fields.push(f);
  }
  return groups;
}

/** Columns for DataGrid built from a target's field catalog. */
export function catalogColumns(target, { visibleKeys = [], exclude = [] } = {}) {
  return target.fields
    .filter((f) => f.key !== 'region' && !exclude.includes(f.key))
    .map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => r[f.key],
      defaultVisible: visibleKeys.includes(f.key),
      wrap: f.key === 'address' || f.key === 'notes',
      render: f.kind === 'email'
        ? (r) => (r[f.key] ? <a href={`mailto:${String(r[f.key]).split(/\s*(?:\/|;|,|\se\s)\s*/i)[0]}`} className="hover:underline" style={{ color: '#93c5fd' }}>{r[f.key]}</a> : <span className="muted">—</span>)
        : undefined,
    }));
}

export const STATUS_META = {
  INSERT: { label: 'Novo', className: 'bg-green-50 text-green-800 border-green-200' },
  UPDATE: { label: 'Atualizar', className: 'bg-blue-50 text-blue-800 border-blue-300' },
  UNCHANGED: { label: 'Sem alteração', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  SKIPPED_EXISTS: { label: 'Já existe', className: 'bg-gray-50 text-gray-700 border-gray-200' },
  DUPLICATE: { label: 'Repetida na planilha', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { label: 'Rejeitada', className: 'bg-red-50 text-red-800 border-red-200' },
};

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, className: 'bg-gray-50 text-gray-700 border-gray-200' };
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${m.className}`}>{m.label}</span>;
}

export const TARGET_ROUTE_LABEL = {
  REGIONS: 'Regionais e contatos',
  BRANCHES: 'Filiais',
  CARRIERS: 'Transportadores',
};
