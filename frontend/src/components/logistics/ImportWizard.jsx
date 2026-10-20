import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import ConfirmDialog from '../ConfirmDialog';
import { groupFields, StatusBadge, STATUS_META, useLogisticsFields } from './logistics';

/**
 * Importação de Excel em etapas:
 *   1 Arquivo  ->  2 Aba e destino  ->  3 Mapeamento  ->  4 Pré-visualização  ->  5 Resultado
 * O arquivo fica no navegador e é reenviado a cada etapa; o servidor
 * recalcula tudo na confirmação e recusa se o banco mudou depois da
 * pré-visualização. Nada é excluído; atualizar registros existentes só
 * acontece no modo escolhido e depois de uma confirmação explícita.
 */

const STEPS = ['Arquivo', 'Aba e destino', 'Mapeamento', 'Pré-visualização', 'Resultado'];
const STATUS_ORDER = ['INSERT', 'UPDATE', 'UNCHANGED', 'SKIPPED_EXISTS', 'DUPLICATE', 'REJECTED'];
const PREVIEW_LIMIT = 300;

function buildForm(file, { sheetName, target, mapping, options }, extra = {}) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheetName', sheetName);
  fd.append('target', target);
  fd.append('mapping', JSON.stringify(mapping));
  fd.append('options', JSON.stringify(options));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

export default function ImportWizard({ open, onClose, onImported, preferredTarget }) {
  const toast = useToast();
  const { targets, byKey, defaultOptions } = useLogisticsFields();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [sheetName, setSheetName] = useState('');
  const [target, setTarget] = useState('');
  const [mapping, setMapping] = useState({});
  const [options, setOptions] = useState(defaultOptions || {});
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep(0); setFile(null); setAnalysis(null); setSheetName(''); setTarget(''); setMapping({});
    setOptions(defaultOptions || {}); setPlan(null); setResult(null); setError(''); setStatusFilter('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (defaultOptions) setOptions((o) => ({ ...defaultOptions, ...o })); }, [defaultOptions]);

  const sheet = analysis?.sheets.find((s) => s.name === sheetName);
  const targetDef = byKey?.[target];

  if (!open) return null;

  const fail = (e) => setError(e.message || 'Não foi possível concluir esta etapa.');

  // Step 1 -> 2
  const analyze = async (f) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setError('Selecione uma planilha Excel no formato .xlsx.'); return; }
    setError(''); setBusy(true); setFile(f);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.postForm('/logistics/import/analyze', fd);
      setAnalysis(res);
      const withTarget = res.sheets.filter((s) => s.suggestedTarget);
      const pick = withTarget.find((s) => s.suggestedTarget === preferredTarget) || withTarget[0] || res.sheets[0];
      if (pick) selectSheet(pick, res);
      setStep(1);
    } catch (e) { fail(e); setFile(null); } finally { setBusy(false); }
  };

  function selectSheet(s, a = analysis) {
    const sh = a.sheets.find((x) => x.name === s.name) || s;
    setSheetName(sh.name);
    const t = sh.suggestedTarget || preferredTarget || 'BRANCHES';
    setTarget(t);
    setMapping(sh.mappings?.[t] || {});
    setPlan(null);
  }

  const changeTarget = (t) => {
    setTarget(t);
    setMapping(sheet?.mappings?.[t] || {});
    setPlan(null);
  };

  // Step 3 -> 4
  const preview = async () => {
    setError(''); setBusy(true);
    try {
      const res = await api.postForm('/logistics/import/preview', buildForm(file, { sheetName, target, mapping, options }));
      setPlan(res);
      setStatusFilter('');
      setStep(3);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  // Step 4 -> 5
  const commit = async () => {
    setConfirmOpen(false);
    setError(''); setBusy(true);
    try {
      const res = await api.postForm('/logistics/import/commit', buildForm(file, { sheetName, target, mapping, options }, {
        planHash: plan.planHash,
        confirmUpdates: plan.summary.UPDATE > 0 ? 'true' : 'false',
      }));
      setResult(res);
      setStep(4);
      toast.success('Importação concluída.');
      onImported?.(target);
    } catch (e) {
      fail(e);
      if (e.code === 'PLAN_CHANGED') setPlan(null);
    } finally { setBusy(false); }
  };

  const mappedCols = new Set(Object.values(mapping).map(Number));
  const missingRequired = targetDef ? targetDef.fields.filter((f) => f.required && mapping[f.key] === undefined) : [];
  const carrierNeedsUnit = target === 'CARRIERS' && mapping.branchName === undefined && mapping.cnpj === undefined;
  const unmappedCols = sheet ? sheet.columns.filter((c) => !mappedCols.has(c.index)) : [];
  const willWrite = plan ? plan.summary.INSERT + plan.summary.UPDATE : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4 overflow-y-auto">
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="bg-white rounded-xl shadow-xl w-full max-w-5xl my-auto flex flex-col max-h-[calc(100vh-2rem)]">
        <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="import-title" className="text-lg font-semibold text-gray-900">Importar planilha Excel</h2>
              <p className="text-xs text-gray-500 mt-0.5">Nada é excluído. Registros existentes só são alterados se você escolher atualizar e confirmar.</p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
          </div>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Etapas">
            {STEPS.map((s, i) => (
              <li key={s} className={`flex items-center gap-1.5 ${i === step ? 'text-blue-700 font-semibold' : i < step ? 'text-gray-700' : 'text-gray-400'}`} aria-current={i === step ? 'step' : undefined}>
                <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center border ${i <= step ? 'border-blue-300 bg-blue-50' : 'border-gray-300'}`}>{i < step ? '✓' : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">
          {error && <p role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}

          {step === 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); analyze(e.dataTransfer.files?.[0]); }}
              className={`border-2 border-dashed rounded-xl px-6 py-12 text-center ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}
            >
              <p className="text-gray-700 font-medium">Arraste a planilha aqui ou</p>
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-3 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {busy ? 'Lendo a planilha...' : 'Selecionar arquivo .xlsx'}
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                onChange={(e) => { analyze(e.target.files?.[0]); e.target.value = ''; }} />
              <p className="mt-4 text-xs text-gray-500 max-w-md mx-auto">
                As abas e os cabeçalhos são identificados automaticamente. Ordem sugerida na primeira carga: regionais, depois filiais, depois transportadores.
              </p>
            </div>
          )}

          {step === 1 && analysis && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Arquivo <strong className="text-gray-900">{analysis.fileName}</strong> · {analysis.sheets.length} aba(s). Escolha a aba que será importada:</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {analysis.sheets.map((s) => (
                  <button key={s.name} type="button" onClick={() => selectSheet(s)}
                    className={`text-left border rounded-xl p-3 hover:shadow-sm ${s.name === sheetName ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}>
                    <span className="block font-semibold text-gray-900">“{s.name}”</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{s.rowCount} linha(s) · {s.columns.length} coluna(s){s.headerRowNumber ? ` · cabeçalho na linha ${s.headerRowNumber}` : ''}</span>
                    {s.suggestedTarget
                      ? <span className="inline-block mt-2 text-xs font-medium text-green-800 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">Reconhecida: {byKey?.[s.suggestedTarget]?.label}</span>
                      : <span className="inline-block mt-2 text-xs text-gray-500">Estrutura não reconhecida — mapeie manualmente</span>}
                  </button>
                ))}
              </div>
              {sheet && (
                <div className="grid sm:grid-cols-2 gap-3 items-end">
                  <label className="block">
                    <span className="block text-xs font-medium text-gray-700 mb-1">Cadastro de destino</span>
                    <select value={target} onChange={(e) => changeTarget(e.target.value)} className="input">
                      {(targets || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </label>
                  <p className="text-xs text-gray-500">{targetDef?.description}</p>
                </div>
              )}
              {sheet && sheet.rowCount === 0 && <p className="text-sm text-amber-700">Esta aba não tem linhas de dados.</p>}
            </div>
          )}

          {step === 2 && sheet && targetDef && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Confira para qual campo do sistema vai cada coluna da aba <strong>“{sheet.name}”</strong>. O mapeamento automático já foi aplicado;
                escolha <em>Não importar</em> para ignorar um campo.
              </p>
              {(missingRequired.length > 0 || carrierNeedsUnit) && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  Falta escolher a coluna de: {[...missingRequired.map((f) => f.label), ...(carrierNeedsUnit ? ['Nome da Filial ou CNPJ'] : [])].join(', ')}.
                </p>
              )}
              {groupFields(targetDef.fields).map((g) => (
                <div key={g.name} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700">{g.name}</div>
                  <div className="divide-y divide-gray-100">
                    {g.fields.map((f) => {
                      const col = sheet.columns.find((c) => c.index === mapping[f.key]);
                      return (
                        <div key={f.key} className="grid sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.2fr)_1.5fr] gap-2 px-3 py-2 items-center text-sm">
                          <span className="text-gray-800">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                          <select
                            value={mapping[f.key] ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMapping((m) => {
                                const next = { ...m };
                                // A column feeds only one field: free it from the previous one.
                                for (const [k, idx] of Object.entries(next)) if (String(idx) === v) delete next[k];
                                if (v === '') delete next[f.key]; else next[f.key] = Number(v);
                                return next;
                              });
                              setPlan(null);
                            }}
                            className="input py-1"
                            aria-label={`Coluna da planilha para ${f.label}`}
                          >
                            <option value="">Não importar</option>
                            {sheet.columns.map((c) => <option key={c.index} value={c.index}>{c.label}</option>)}
                          </select>
                          <span className="text-xs text-gray-500 truncate" title={col?.samples.join(' · ')}>{col ? (col.samples.join(' · ') || 'sem valores') : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {unmappedCols.length > 0 && (
                <p className="text-xs text-gray-500">Colunas da planilha que não serão importadas: {unmappedCols.map((c) => `“${c.label}”`).join(', ')}.</p>
              )}

              <fieldset className="border border-gray-200 rounded-lg px-4 pt-2 pb-3">
                <legend className="px-1 text-sm font-semibold text-gray-700">Opções da importação</legend>
                <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-700">
                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-gray-600">Registros que já existem</span>
                    <Radio name="mode" checked={options.mode !== 'UPSERT'} onChange={() => { setOptions((o) => ({ ...o, mode: 'INSERT_ONLY' })); setPlan(null); }}>
                      Inserir só os novos (não alterar os existentes)
                    </Radio>
                    <Radio name="mode" checked={options.mode === 'UPSERT'} onChange={() => { setOptions((o) => ({ ...o, mode: 'UPSERT' })); setPlan(null); }}>
                      Inserir novos e atualizar os existentes
                    </Radio>
                  </div>
                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-gray-600">Linhas repetidas na planilha (mesma identificação)</span>
                    <Radio name="dup" checked={options.duplicateStrategy !== 'FIRST'} onChange={() => { setOptions((o) => ({ ...o, duplicateStrategy: 'MERGE' })); setPlan(null); }}>
                      Mesclar: completar campos vazios da primeira
                    </Radio>
                    <Radio name="dup" checked={options.duplicateStrategy === 'FIRST'} onChange={() => { setOptions((o) => ({ ...o, duplicateStrategy: 'FIRST' })); setPlan(null); }}>
                      Manter só a primeira
                    </Radio>
                  </div>
                  <Check checked={options.placeholdersAsEmpty !== false} onChange={(v) => { setOptions((o) => ({ ...o, placeholdersAsEmpty: v })); setPlan(null); }}>
                    Tratar “NA”, “-” e “Não tem” como vazio
                  </Check>
                  {options.mode === 'UPSERT' && (
                    <Check checked={options.keepExistingWhenEmpty !== false} onChange={(v) => { setOptions((o) => ({ ...o, keepExistingWhenEmpty: v })); setPlan(null); }}>
                      Célula vazia não apaga o valor já cadastrado
                    </Check>
                  )}
                  {target !== 'REGIONS' && (
                    <Check checked={options.createMissingRegions === true} onChange={(v) => { setOptions((o) => ({ ...o, createMissingRegions: v })); setPlan(null); }}>
                      Cadastrar regionais que ainda não existem
                    </Check>
                  )}
                </div>
              </fieldset>
            </div>
          )}

          {step === 3 && plan && (
            <PreviewStep plan={plan} statusFilter={statusFilter} setStatusFilter={setStatusFilter} targetLabel={targetDef?.label} />
          )}

          {step === 4 && result && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">Importação registrada no histórico (lote nº {result.batchId}).</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <ResultCard label="Inseridos" value={result.inserted} tone="text-green-700" />
                <ResultCard label="Atualizados" value={result.updated} tone="text-blue-700" />
                <ResultCard label="Sem alteração" value={result.unchanged} />
                <ResultCard label="Ignorados" value={result.skipped} hint="já existiam ou repetidos" />
                <ResultCard label="Rejeitados" value={result.rejected} tone={result.rejected ? 'text-red-700' : undefined} />
              </div>
              {result.regionsCreated > 0 && <p className="text-sm text-gray-700">{result.regionsCreated} regional(is) cadastrada(s) automaticamente.</p>}
              {result.rejected > 0 && <p className="text-sm text-gray-600">As linhas rejeitadas e o motivo de cada uma ficam no histórico de importações.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-6 py-3 border-t border-gray-100">
          <div>
            {step > 0 && step < 4 && (
              <button type="button" disabled={busy} onClick={() => { setError(''); setStep((s) => s - 1); }} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">Voltar</button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">{step === 4 ? 'Fechar' : 'Cancelar'}</button>
            {step === 1 && (
              <button type="button" disabled={!sheet || !sheet.rowCount} onClick={() => setStep(2)} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">Avançar</button>
            )}
            {step === 2 && (
              <button type="button" disabled={busy || missingRequired.length > 0 || carrierNeedsUnit} onClick={preview} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Validando...' : 'Gerar pré-visualização'}
              </button>
            )}
            {step === 3 && plan && (
              <button type="button" disabled={busy || willWrite === 0} onClick={() => setConfirmOpen(true)} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                title={willWrite === 0 ? 'Não há registros para inserir ou atualizar.' : undefined}>
                {busy ? 'Importando...' : 'Importar'}
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar importação"
        description={plan ? confirmText(plan, targetDef?.label) : ''}
        confirmLabel={plan?.summary.UPDATE ? `Inserir ${plan.summary.INSERT} e atualizar ${plan.summary.UPDATE}` : `Inserir ${plan?.summary.INSERT ?? 0}`}
        onConfirm={commit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function confirmText(plan, label) {
  const s = plan.summary;
  const parts = [`${s.INSERT} novo(s) registro(s) em ${label}`];
  if (s.UPDATE) parts.push(`${s.UPDATE} registro(s) existente(s) terão os valores mostrados na coluna "Alterações" substituídos`);
  const ignored = s.UNCHANGED + s.SKIPPED_EXISTS + s.DUPLICATE;
  if (ignored) parts.push(`${ignored} linha(s) ignorada(s)`);
  if (s.REJECTED) parts.push(`${s.REJECTED} linha(s) rejeitada(s) não serão gravadas`);
  if (s.newRegions?.length) parts.push(`regionais novas: ${s.newRegions.join(', ')}`);
  return `${parts.join('; ')}. Nenhum registro será excluído.`;
}

function PreviewStep({ plan, statusFilter, setStatusFilter, targetLabel }) {
  const rows = useMemo(() => plan.rows.filter((r) => !statusFilter || (statusFilter === 'WARN' ? r.warnings.length > 0 : r.status === statusFilter)), [plan, statusFilter]);
  const s = plan.summary;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {s.total} linha(s) da aba <strong>“{plan.sheetName}”</strong> para <strong>{targetLabel}</strong>.
        {s.newRegions?.length > 0 && <> Regionais que serão cadastradas: <strong>{s.newRegions.join(', ')}</strong>.</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <FilterChip active={!statusFilter} onClick={() => setStatusFilter('')}>Todas ({s.total})</FilterChip>
        {STATUS_ORDER.filter((st) => s[st] > 0).map((st) => (
          <FilterChip key={st} active={statusFilter === st} onClick={() => setStatusFilter(statusFilter === st ? '' : st)}>
            {STATUS_META[st].label} ({s[st]})
          </FilterChip>
        ))}
        {s.withWarnings > 0 && <FilterChip active={statusFilter === 'WARN'} onClick={() => setStatusFilter(statusFilter === 'WARN' ? '' : 'WARN')}>Com avisos ({s.withWarnings})</FilterChip>}
      </div>
      <div className="border border-gray-200 rounded-lg overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Linha</th>
              <th className="text-left px-3 py-2 font-semibold">Situação</th>
              <th className="text-left px-3 py-2 font-semibold">Registro</th>
              <th className="text-left px-3 py-2 font-semibold">Regional</th>
              <th className="text-left px-3 py-2 font-semibold min-w-[18rem]">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.slice(0, PREVIEW_LIMIT).map((r) => (
              <tr key={r.rowNumber} className="align-top">
                <td className="px-3 py-2 tabular-nums text-gray-500">{r.rowNumber}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-gray-900">{r.label || <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{r.regionName || '—'}{r.regionIsNew && <span className="ml-1 text-xs text-amber-700">(nova)</span>}</td>
                <td className="px-3 py-2 text-xs space-y-1">
                  {r.errors.map((e) => <p key={e} className="text-red-700">✕ {e}</p>)}
                  {r.changes.length > 0 && (
                    <div className="text-blue-800">
                      <p className="font-semibold">Alterações:</p>
                      <ul className="list-disc pl-4">
                        {r.changes.map((c) => <li key={c.field}><span className="text-gray-600">{c.label}:</span> <s className="text-gray-400">{c.oldValue ?? 'vazio'}</s> → {c.newValue ?? 'vazio'}</li>)}
                      </ul>
                    </div>
                  )}
                  {r.warnings.map((w) => <p key={w} className="text-amber-700">⚠ {w}</p>)}
                  {!r.errors.length && !r.changes.length && !r.warnings.length && <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Nenhuma linha nesta situação.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_LIMIT && <p className="text-xs text-gray-500">Mostrando as primeiras {PREVIEW_LIMIT} de {rows.length} linhas; use os filtros acima para ver as demais.</p>}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`px-3 py-1 rounded-full border text-xs font-medium ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
      {children}
    </button>
  );
}

function Radio({ name, checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="text-blue-600" />
      {children}
    </label>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded border-gray-300 text-blue-600" />
      {children}
    </label>
  );
}

function ResultCard({ label, value, tone = 'text-gray-900', hint }) {
  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <span className="block text-xs text-gray-500">{label}</span>
      <span className={`block text-2xl font-bold ${tone}`}>{value}</span>
      {hint && <span className="block text-xs text-gray-400">{hint}</span>}
    </div>
  );
}
