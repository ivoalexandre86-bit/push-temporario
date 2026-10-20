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
import { RegionDetailModal, RegionFormModal } from '../components/logistics/RegionModals';
import { catalogColumns, useLogisticsFields } from '../components/logistics/logistics';
import { PERMISSIONS } from '../utils/constants';
import { formatDate } from '../utils/format';

const TABS = [
  { key: 'regionais', label: 'Regionais' },
  { key: 'filiais', label: 'Filiais' },
  { key: 'importacoes', label: 'Importações' },
];

const BRANCH_DEFAULT_COLS = ['branchName', 'complex', 'state', 'branchCode', 'cnpj', 'unitManagerName', 'logisticsCoordName', 'logisticsCoordMobile'];

const uniqueOptions = (rows, get) => [...new Set(rows.map(get).filter(Boolean))]
  .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }))
  .map((v) => ({ value: String(v), label: String(v) }));

const contactOf = (region, dept) => region.contacts.find((c) => c.department?.toLowerCase() === dept);

export default function Regions() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { byKey, error: fieldsError } = useLogisticsFields();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('aba')) ? params.get('aba') : 'regionais';
  const canManage = hasPermission(PERMISSIONS.LOGISTICS_MANAGE);
  const canImport = hasPermission(PERMISSIONS.LOGISTICS_IMPORT);
  const canExport = hasPermission(PERMISSIONS.REPORTS_EXPORT);

  const [regions, setRegions] = useState(null);
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const [filtersCollapsed, toggleFilters] = useFiltersCollapsed();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ region: [], state: [], complex: [], company: [] });
  const [selectedRegions, setSelectedRegions] = useState(new Set());
  const [selectedBranches, setSelectedBranches] = useState(new Set());
  const [visibleRegions, setVisibleRegions] = useState(null);
  const [visibleBranches, setVisibleBranches] = useState(null);

  const [showImport, setShowImport] = useState(false);
  const [regionForm, setRegionForm] = useState(null); // null closed | {} new | region
  const [detailId, setDetailId] = useState(null);
  const [branchForm, setBranchForm] = useState(null); // null closed | {} new | branch
  const [confirm, setConfirm] = useState(null); // { title, description, run }

  const load = useCallback(() => {
    setError('');
    return Promise.all([api.get('/logistics/regions'), api.get('/logistics/branches')])
      .then(([r, b]) => { setRegions(r.items); setBranches(b.items); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ?regional=ID preselects the region filter (link from the region detail)
  useEffect(() => {
    const rid = params.get('regional');
    if (rid) setF((cur) => ({ ...cur, region: [rid] }));
  }, [params]);

  const setTab = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set('aba', key); n.delete('regional'); return n; }, { replace: true });

  const filteredBranches = useMemo(() => (branches || []).filter((b) => (
    (!f.region.length || f.region.includes(String(b.regionId)))
    && (!f.state.length || f.state.includes(String(b.state)))
    && (!f.complex.length || f.complex.includes(String(b.complex)))
    && (!f.company.length || f.company.includes(String(b.company)))
  )), [branches, f]);

  const filteredRegions = useMemo(() => (regions || []).filter((r) => !f.region.length || f.region.includes(String(r.id))), [regions, f.region]);

  const activeCount = (q.trim() ? 1 : 0) + (f.region.length ? 1 : 0) + (tab === 'filiais' ? ['state', 'complex', 'company'].filter((k) => f[k].length).length : 0);
  const clearAll = () => { setQ(''); setF({ region: [], state: [], complex: [], company: [] }); };

  const regionColumns = useMemo(() => [
    { key: 'name', label: 'Regional', get: (r) => r.name, locked: true, defaultSort: true },
    { key: 'responsible', label: 'Responsável (Regionais)', get: (r) => contactOf(r, 'regionais')?.name },
    { key: 'responsibleEmail', label: 'E-mail do responsável', get: (r) => contactOf(r, 'regionais')?.email },
    { key: 'scheduler', label: 'Programador', get: (r) => contactOf(r, 'programador')?.name },
    { key: 'schedulerEmail', label: 'E-mail do programador', get: (r) => contactOf(r, 'programador')?.email, defaultVisible: false },
    { key: 'branchCount', label: 'Filiais', get: (r) => r.branchCount, numeric: true },
    { key: 'carrierCount', label: 'Transportadores', get: (r) => r.carrierCount, numeric: true },
    { key: 'carrierCompanyCount', label: 'Transportadoras', get: (r) => r.carrierCompanyCount, numeric: true, defaultVisible: false },
    { key: 'contactCount', label: 'Contatos', get: (r) => r.contactCount, numeric: true },
    { key: 'updatedAt', label: 'Atualizado em', get: (r) => r.updatedAt, render: (r) => formatDate(r.updatedAt), defaultVisible: false },
  ], []);

  const branchColumns = useMemo(() => {
    if (!byKey?.BRANCHES) return null;
    const cols = catalogColumns(byKey.BRANCHES, { visibleKeys: BRANCH_DEFAULT_COLS });
    const nameCol = cols.find((c) => c.key === 'branchName');
    return [
      { ...nameCol, locked: true, defaultSort: true, wrap: true },
      { key: 'regionName', label: 'Regional', get: (b) => b.regionName },
      ...cols.filter((c) => c.key !== 'branchName'),
      { key: 'carrierCount', label: 'Transportadores', get: (b) => b.carrierCount, numeric: true },
      { key: 'updatedAt', label: 'Atualizado em', get: (b) => b.updatedAt, render: (b) => formatDate(b.updatedAt), defaultVisible: false },
    ];
  }, [byKey]);

  if (error || fieldsError) return <ErrorState message={error || fieldsError} onRetry={load} />;
  if (!regions || !branches) return <Loading />;

  const exportRows = async (kind, ids) => {
    const base = kind === 'regions' ? '/logistics/regions/export' : '/logistics/branches/export';
    const qs = new URLSearchParams({ format: 'xlsx' });
    const all = kind === 'regions' ? regions : branches;
    const shown = (kind === 'regions' ? visibleRegions : visibleBranches) || all;
    const list = ids || shown.map((r) => r.id);
    if (!list.length) { toast.info('Nenhum registro para exportar.'); return; }
    if (ids || list.length !== all.length) qs.set('ids', list.join(','));
    const desc = [q.trim() && `Busca: ${q.trim()}`, f.region.length && `Regional: ${f.region.map((id) => regions.find((r) => String(r.id) === id)?.name).join(', ')}`].filter(Boolean).join(' · ');
    if (desc) qs.set('filters', desc);
    try {
      await downloadFile(`${base}?${qs}`, kind === 'regions' ? 'regionais.xlsx' : 'filiais.xlsx');
    } catch (e) { toast.error(e.message); }
  };

  const bulkDelete = (kind, ids, clear) => setConfirm({
    title: `Excluir ${ids.length} registro(s)`,
    description: kind === 'regions'
      ? 'Regionais com filiais ou transportadores vinculados não são excluídas (o motivo é mostrado). Os contatos da regional são excluídos junto. A exclusão é registrada na auditoria.'
      : 'Filiais com transportadores vinculados não são excluídas (o motivo é mostrado). A exclusão é registrada na auditoria.',
    run: async () => {
      try {
        const res = await api.post(`/logistics/${kind}/bulk-delete`, { ids });
        if (res.deleted.length) toast.success(`${res.deleted.length} registro(s) excluído(s).`);
        if (res.blocked.length) toast.error(`${res.blocked.length} não excluído(s): ${res.blocked[0].reason}${res.blocked.length > 1 ? ' (e outros)' : ''}`);
        clear(new Set());
        load();
      } catch (e) { toast.error(e.message); }
    },
  });

  const deleteOne = (kind, row, label) => setConfirm({
    title: `Excluir ${kind === 'regions' ? 'regional' : 'filial'}`,
    description: `Excluir "${label}"? ${kind === 'regions' ? 'Os contatos da regional são excluídos junto. ' : ''}A exclusão é registrada na auditoria.`,
    run: async () => {
      try {
        await api.del(`/logistics/${kind}/${row.id}`);
        toast.success('Registro excluído.');
        load();
      } catch (e) { toast.error(e.message); }
    },
  });

  const totalCarriers = regions.reduce((acc, r) => acc + (r.carrierCount || 0), 0);
  const regionOptions = regions.map((r) => ({ value: String(r.id), label: r.name }));
  const regionName = (id) => regions.find((r) => String(r.id) === String(id))?.name;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Regionais</h1>
          <p className="text-sm text-gray-500">Regionais, contatos por departamento e filiais (unidades) de cada regional.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab !== 'importacoes' && <FilterToggleButton collapsed={filtersCollapsed} onToggle={toggleFilters} activeCount={activeCount} />}
          {tab !== 'importacoes' && <ClearFiltersButton onClear={clearAll} activeCount={activeCount} />}
          {canExport && tab !== 'importacoes' && (
            <button type="button" onClick={() => exportRows(tab === 'filiais' ? 'branches' : 'regions', null)} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
              Exportar Excel
            </button>
          )}
          {canImport && (
            <button type="button" onClick={() => setShowImport(true)} className="px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100">
              Importar Excel
            </button>
          )}
          {canManage && tab === 'regionais' && <button type="button" onClick={() => setRegionForm({})} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">+ Nova regional</button>}
          {canManage && tab === 'filiais' && <button type="button" onClick={() => setBranchForm({})} disabled={!regions.length} className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">+ Nova filial</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Regionais" value={regions.length} onClick={() => setTab('regionais')} active={tab === 'regionais'} />
        <KpiCard label="Filiais" value={branches.length} tone="blue" onClick={() => setTab('filiais')} active={tab === 'filiais'} />
        <KpiCard label="Transportadores" value={totalCarriers} tone="green" sublabel="vinculados às regionais" />
        <KpiCard label="Contatos" value={regions.reduce((acc, r) => acc + (r.contactCount || 0), 0)} tone="amber" sublabel="por departamento" />
      </div>

      <div className="flex gap-1 border-b border-[var(--color-border)] mb-4" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'importacoes' && !filtersCollapsed && (
        <FilterPanel activeCount={activeCount} onClear={clearAll} collapsed={false} onToggle={toggleFilters}>
          <div className="flex flex-wrap gap-3 items-end">
            <MultiSelect label="Regional" options={regionOptions} value={f.region} onChange={(v) => setF((x) => ({ ...x, region: v }))} />
            {tab === 'filiais' && (
              <>
                <MultiSelect label="UF" options={uniqueOptions(branches, (b) => b.state)} value={f.state} onChange={(v) => setF((x) => ({ ...x, state: v }))} />
                <MultiSelect label="Complexo" options={uniqueOptions(branches, (b) => b.complex)} value={f.complex} onChange={(v) => setF((x) => ({ ...x, complex: v }))} />
                <MultiSelect label="Empresa" options={uniqueOptions(branches, (b) => b.company)} value={f.company} onChange={(v) => setF((x) => ({ ...x, company: v }))} />
              </>
            )}
            <div className="flex-1 min-w-[12rem]">
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="regions-q">Pesquisa rápida</label>
              <input id="regions-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CNPJ, contato, e-mail, telefone..."
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
        </FilterPanel>
      )}
      {tab !== 'importacoes' && filtersCollapsed && (
        <div className="mb-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa rápida: nome, CNPJ, contato, e-mail, telefone..." aria-label="Pesquisa rápida"
            className="w-full sm:max-w-md rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        </div>
      )}

      {tab === 'regionais' && (regions.length === 0 ? (
        <EmptyState title="Nenhuma regional cadastrada" description="Importe a aba “REGIONAIS” da planilha ou cadastre uma regional." />
      ) : (
        <DataGrid
          storageKey="logistica.regionais.colunas"
          columns={regionColumns}
          rows={filteredRegions}
          search={q}
          selectable={canManage || canExport}
          selected={selectedRegions}
          onSelectedChange={setSelectedRegions}
          onVisibleRowsChange={setVisibleRegions}
          onRowClick={(r) => setDetailId(r.id)}
          cardTitle={(r) => r.name}
          rowActions={(r) => (
            <RowActionButtons
              onEdit={canManage ? () => setRegionForm(r) : undefined}
              onDelete={canManage ? () => deleteOne('regions', r, r.name) : undefined}
              editLabel={`Editar ${r.name}`}
              deleteLabel={`Excluir ${r.name}`}
            />
          )}
          bulkBar={(rows) => (
            <>
              {canExport && <button type="button" onClick={() => exportRows('regions', rows.map((r) => r.id))} className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Exportar selecionados</button>}
              {canManage && <button type="button" onClick={() => bulkDelete('regions', rows.map((r) => r.id), setSelectedRegions)} className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50">Excluir selecionados</button>}
            </>
          )}
        />
      ))}

      {tab === 'filiais' && branchColumns && (branches.length === 0 ? (
        <EmptyState title="Nenhuma filial cadastrada" description="Importe a aba de filiais (“Regionais ”) da planilha ou cadastre uma filial." />
      ) : (
        <DataGrid
          storageKey="logistica.filiais.colunas"
          columns={branchColumns}
          rows={filteredBranches}
          search={q}
          selectable={canManage || canExport}
          selected={selectedBranches}
          onSelectedChange={setSelectedBranches}
          onVisibleRowsChange={setVisibleBranches}
          onRowClick={canManage ? (b) => setBranchForm(b) : (b) => setDetailId(b.regionId)}
          cardTitle={(b) => `${b.branchName} · ${b.regionName}`}
          rowActions={(b) => (
            <RowActionButtons
              onEdit={canManage ? () => setBranchForm(b) : undefined}
              onDelete={canManage ? () => deleteOne('branches', b, b.branchName) : undefined}
              editLabel={`Editar ${b.branchName}`}
              deleteLabel={`Excluir ${b.branchName}`}
            />
          )}
          bulkBar={(rows) => (
            <>
              {canExport && <button type="button" onClick={() => exportRows('branches', rows.map((r) => r.id))} className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Exportar selecionados</button>}
              {canManage && <button type="button" onClick={() => bulkDelete('branches', rows.map((r) => r.id), setSelectedBranches)} className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50">Excluir selecionados</button>}
            </>
          )}
        />
      ))}

      {tab === 'importacoes' && <ImportHistory reloadKey={historyKey} targets={['REGIONS', 'BRANCHES']} />}

      <ImportWizard
        open={showImport}
        preferredTarget={tab === 'filiais' ? 'BRANCHES' : 'REGIONS'}
        onClose={() => setShowImport(false)}
        onImported={() => { load(); setHistoryKey((k) => k + 1); }}
      />
      <RegionFormModal open={regionForm !== null} region={regionForm?.id ? regionForm : null} onClose={() => setRegionForm(null)} onSaved={load} />
      <RegionDetailModal
        regionId={detailId}
        canManage={canManage}
        contactTarget={byKey?.REGIONS}
        onClose={() => setDetailId(null)}
        onChanged={load}
        onShowBranches={(id) => { setDetailId(null); setParams({ aba: 'filiais', regional: String(id) }, { replace: true }); }}
      />
      <RecordFormModal
        open={branchForm !== null}
        target={byKey?.BRANCHES}
        record={branchForm?.id ? branchForm : null}
        regions={regions}
        defaultRegionId={f.region.length === 1 ? f.region[0] : undefined}
        onClose={() => setBranchForm(null)}
        onSaved={load}
      />
      <ConfirmDialog
        open={!!confirm}
        danger
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel="Excluir"
        onConfirm={() => { const c = confirm; setConfirm(null); c.run(); }}
        onCancel={() => setConfirm(null)}
      />
      {f.region.length === 1 && tab === 'filiais' && (
        <p className="sr-only" aria-live="polite">Filtrando filiais da regional {regionName(f.region[0])}</p>
      )}
    </div>
  );
}
