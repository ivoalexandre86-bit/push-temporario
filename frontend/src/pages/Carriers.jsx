import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Loading, ErrorState, EmptyState } from '../components/Loading';
import KpiCard from '../components/KpiCard';
import MultiSelect from '../components/MultiSelect';
import FilterPanel, { ClearFiltersButton, FilterToggleButton, useFiltersCollapsed } from '../components/FilterPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import DataGrid, { RowActionButtons } from '../components/logistics/DataGrid';
import RecordFormModal from '../components/logistics/RecordFormModal';
import ImportWizard from '../components/logistics/ImportWizard';
import ImportHistory from '../components/logistics/ImportHistory';
import { RegionDetailModal } from '../components/logistics/RegionModals';
import { catalogColumns, useLogisticsFields } from '../components/logistics/logistics';
import { PERMISSIONS, pillStyle } from '../utils/constants';
import { formatDate } from '../utils/format';

const DEFAULT_COLS = ['carrierName', 'branchName', 'state', 'managerName', 'schedulerName', 'schedulerMobile', 'unitContactName'];
const EMPTY_FILTERS = { region: [], carrier: [], state: [], branch: [], link: [] };

const uniqueOptions = (rows, get) => [...new Set(rows.map(get).filter(Boolean))]
  .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }))
  .map((v) => ({ value: String(v), label: String(v) }));

export default function Carriers() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { byKey, error: fieldsError } = useLogisticsFields();
  const [params] = useSearchParams();
  const canManage = hasPermission(PERMISSIONS.LOGISTICS_MANAGE);
  const canImport = hasPermission(PERMISSIONS.LOGISTICS_IMPORT);
  const canExport = hasPermission(PERMISSIONS.REPORTS_EXPORT);

  const [carriers, setCarriers] = useState(null);
  const [regions, setRegions] = useState([]);
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState('');
  const [view, setView] = useState('cadastro');
  const [historyKey, setHistoryKey] = useState(0);
  const [filtersCollapsed, toggleFilters] = useFiltersCollapsed();
  const [q, setQ] = useState('');
  const [f, setF] = useState(() => ({ ...EMPTY_FILTERS, region: params.get('regional') ? [params.get('regional')] : [] }));
  const [selected, setSelected] = useState(new Set());
  const [visibleRows, setVisibleRows] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(() => {
    setError('');
    return Promise.all([api.get('/logistics/carriers'), api.get('/logistics/regions'), api.get('/logistics/branches')])
      .then(([c, r, b]) => { setCarriers(c.items); setRegions(r.items); setBranches(b.items); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => (carriers || []).filter((c) => (
    (!f.region.length || f.region.includes(String(c.regionId)))
    && (!f.carrier.length || f.carrier.includes(c.carrierName))
    && (!f.state.length || f.state.includes(String(c.state)))
    && (!f.branch.length || f.branch.includes(c.branchName))
    && (!f.link.length || f.link.includes(c.branchId ? 'linked' : 'unlinked'))
  )), [carriers, f]);

  const columns = useMemo(() => {
    if (!byKey?.CARRIERS) return null;
    const cols = catalogColumns(byKey.CARRIERS, { visibleKeys: DEFAULT_COLS });
    const nameCol = cols.find((c) => c.key === 'carrierName');
    return [
      { ...nameCol, locked: true, defaultSort: true },
      { key: 'regionName', label: 'Regional', get: (c) => c.regionName },
      ...cols.filter((c) => c.key !== 'carrierName'),
      {
        key: 'linked', label: 'Filial vinculada', get: (c) => (c.branchId ? c.linkedBranchName : null),
        render: (c) => (c.branchId
          ? <span className="dg-pill" style={pillStyle('#4ade80')}>{c.linkedBranchName}</span>
          : <span className="dg-pill" style={pillStyle('#fbbf24')} title="A unidade desta linha não está no cadastro de filiais">Sem vínculo</span>),
      },
      { key: 'updatedAt', label: 'Atualizado em', get: (c) => c.updatedAt, render: (c) => formatDate(c.updatedAt), defaultVisible: false },
    ];
  }, [byKey]);

  if (error || fieldsError) return <ErrorState message={error || fieldsError} onRetry={load} />;
  if (!carriers || !columns) return <Loading />;

  const activeCount = (q.trim() ? 1 : 0) + Object.values(f).filter((v) => v.length).length;
  const clearAll = () => { setQ(''); setF(EMPTY_FILTERS); };
  const companies = new Set(filtered.map((c) => c.carrierName));
  const units = new Set(filtered.map((c) => c.cnpj || c.branchName));
  const unlinked = (carriers || []).filter((c) => !c.branchId).length;
  const carrierNames = [...new Set(carriers.map((c) => c.carrierName))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const exportRows = async (ids) => {
    const qs = new URLSearchParams({ format: 'xlsx' });
    const shown = visibleRows || filtered;
    const list = ids || shown.map((c) => c.id);
    if (ids || shown.length !== carriers.length) qs.set('ids', list.join(','));
    const desc = [
      q.trim() && `Busca: ${q.trim()}`,
      f.region.length && `Regional: ${f.region.map((id) => regions.find((r) => String(r.id) === id)?.name).join(', ')}`,
      f.carrier.length && `Transportadora: ${f.carrier.join(', ')}`,
      f.state.length && `UF: ${f.state.join(', ')}`,
    ].filter(Boolean).join(' · ');
    if (desc) qs.set('filters', desc);
    if (!list.length) { toast.info('Nenhum registro para exportar.'); return; }
    try { await downloadFile(`/logistics/carriers/export?${qs}`, 'transportadores.xlsx'); } catch (e) { toast.error(e.message); }
  };

  const remove = (ids) => setConfirm({
    title: ids.length === 1 ? 'Excluir transportador' : `Excluir ${ids.length} transportadores`,
    description: 'A exclusão é registrada na auditoria e pode ser consultada depois.',
    run: async () => {
      try {
        if (ids.length === 1) await api.del(`/logistics/carriers/${ids[0]}`);
        else await api.post('/logistics/carriers/bulk-delete', { ids });
        toast.success(`${ids.length} registro(s) excluído(s).`);
        setSelected(new Set());
        load();
      } catch (e) { toast.error(e.message); }
    },
  });

  const toggleCarrier = (name) => setF((x) => ({ ...x, carrier: x.carrier.length === 1 && x.carrier[0] === name ? [] : [name] }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Transportadores</h1>
          <p className="text-sm text-gray-500">Transportadora que atende cada unidade, com gerente, programador e contato da unidade.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'cadastro' && <FilterToggleButton collapsed={filtersCollapsed} onToggle={toggleFilters} activeCount={activeCount} />}
          {view === 'cadastro' && <ClearFiltersButton onClear={clearAll} activeCount={activeCount} />}
          {canExport && view === 'cadastro' && <button type="button" onClick={() => exportRows(null)} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">Exportar Excel</button>}
          {canImport && <button type="button" onClick={() => setShowImport(true)} className="px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100">Importar Excel</button>}
          {canManage && <button type="button" onClick={() => setForm({})} disabled={!regions.length} title={!regions.length ? 'Cadastre ou importe as regionais primeiro.' : undefined} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">+ Novo transportador</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Registros" value={filtered.length} sublabel={filtered.length !== carriers.length ? `de ${carriers.length}` : 'transportadora × unidade'} />
        <KpiCard label="Transportadoras" value={companies.size} tone="blue" />
        <KpiCard label="Unidades atendidas" value={units.size} tone="green" />
        <KpiCard
          label="Sem filial vinculada"
          value={unlinked}
          tone="amber"
          onClick={() => setF((x) => ({ ...x, link: x.link.includes('unlinked') ? [] : ['unlinked'] }))}
          active={f.link.includes('unlinked')}
          sublabel={f.link.includes('unlinked') ? 'Filtro ativo' : 'unidade fora do cadastro de filiais'}
        />
      </div>

      <div className="flex gap-1 border-b border-[var(--color-border)] mb-4" role="tablist">
        {[['cadastro', 'Cadastro'], ['importacoes', 'Importações']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${view === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'importacoes' && <ImportHistory reloadKey={historyKey} targets={['CARRIERS']} />}

      {view === 'cadastro' && (
        <>
          {/* Quick filter by carrier company */}
          {carrierNames.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3" aria-label="Filtrar por transportadora">
              {carrierNames.map((name) => {
                const on = f.carrier.includes(name);
                return (
                  <button key={name} type="button" onClick={() => toggleCarrier(name)} aria-pressed={on}
                    className={`px-3 py-1 rounded-full border text-xs font-medium ${on ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    {name} <span className="text-gray-400">{carriers.filter((c) => c.carrierName === name).length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {!filtersCollapsed ? (
            <FilterPanel activeCount={activeCount} onClear={clearAll} collapsed={false} onToggle={toggleFilters}>
              <div className="flex flex-wrap gap-3 items-end">
                <MultiSelect label="Regional" options={regions.map((r) => ({ value: String(r.id), label: r.name }))} value={f.region} onChange={(v) => setF((x) => ({ ...x, region: v }))} />
                <MultiSelect label="Transportadora" options={carrierNames.map((n) => ({ value: n, label: n }))} value={f.carrier} onChange={(v) => setF((x) => ({ ...x, carrier: v }))} />
                <MultiSelect label="Unidade" options={uniqueOptions(carriers, (c) => c.branchName)} value={f.branch} onChange={(v) => setF((x) => ({ ...x, branch: v }))} />
                <MultiSelect label="UF" options={uniqueOptions(carriers, (c) => c.state)} value={f.state} onChange={(v) => setF((x) => ({ ...x, state: v }))} />
                <MultiSelect label="Vínculo com filial" options={[{ value: 'linked', label: 'Com filial vinculada' }, { value: 'unlinked', label: 'Sem filial vinculada' }]} value={f.link} onChange={(v) => setF((x) => ({ ...x, link: v }))} />
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="carriers-q">Pesquisa rápida</label>
                  <input id="carriers-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Transportadora, unidade, contato, e-mail..."
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
            </FilterPanel>
          ) : (
            <div className="mb-3">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa rápida: transportadora, unidade, contato, e-mail..." aria-label="Pesquisa rápida"
                className="w-full sm:max-w-md rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            </div>
          )}

          {carriers.length === 0 ? (
            <EmptyState title="Nenhum transportador cadastrado" description="Importe a aba “TRANSPORTADOR” da planilha ou cadastre um transportador." />
          ) : (
            <DataGrid
              storageKey="logistica.transportadores.colunas"
              columns={columns}
              rows={filtered}
              search={q}
              selectable={canManage || canExport}
              selected={selected}
              onSelectedChange={setSelected}
              onVisibleRowsChange={setVisibleRows}
              onRowClick={canManage ? (c) => setForm(c) : (c) => setDetailId(c.regionId)}
              cardTitle={(c) => `${c.carrierName} · ${c.branchName || c.linkedBranchName || c.cnpj || ''}`}
              rowAccent={(c) => (c.branchId ? '#4ade80' : '#fbbf24')}
              rowActions={(c) => (
                <RowActionButtons
                  onEdit={canManage ? () => setForm(c) : undefined}
                  onDelete={canManage ? () => remove([c.id]) : undefined}
                  editLabel={`Editar ${c.carrierName}`}
                  deleteLabel={`Excluir ${c.carrierName}`}
                />
              )}
              bulkBar={(rows) => (
                <>
                  {canExport && <button type="button" onClick={() => exportRows(rows.map((r) => r.id))} className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Exportar selecionados</button>}
                  {canManage && <button type="button" onClick={() => remove(rows.map((r) => r.id))} className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50">Excluir selecionados</button>}
                </>
              )}
            />
          )}
        </>
      )}

      <ImportWizard open={showImport} preferredTarget="CARRIERS" onClose={() => setShowImport(false)} onImported={() => { load(); setHistoryKey((k) => k + 1); }} />
      <RecordFormModal
        open={form !== null}
        target={byKey?.CARRIERS}
        record={form?.id ? form : null}
        regions={regions}
        branches={branches}
        carrierNames={carrierNames}
        defaultRegionId={f.region.length === 1 ? f.region[0] : undefined}
        onClose={() => setForm(null)}
        onSaved={load}
      />
      <RegionDetailModal regionId={detailId} canManage={false} contactTarget={byKey?.REGIONS} onClose={() => setDetailId(null)} />
      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel="Excluir"
        onConfirm={() => { const c = confirm; setConfirm(null); c.run(); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
