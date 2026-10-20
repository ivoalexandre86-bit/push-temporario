import { useEffect, useMemo, useState } from 'react';
import ColumnChooser, { SortHeader } from '../ColumnChooser';

/**
 * Grid used by the Regionais / Filiais / Transportadores screens, in the
 * same dark style as the Projetos grid (.dg). Everything runs client-side
 * (these registries are small): sorting, per-column filters, quick search,
 * multi-select, pagination and visible columns (remembered per screen).
 *
 * columns: [{ key, label, get(row) -> sortable/filterable value, render?(row), numeric?, defaultVisible?, locked? }]
 * Rows outside the current filters stay selected only while visible.
 */

const PAGE_SIZES = [25, 50, 100];

export function normalizeText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const isEmpty = (v) => v === null || v === undefined || v === '';

function useGridColumns(storageKey, columns) {
  const allKeys = columns.map((c) => c.key);
  const locked = columns.filter((c) => c.locked).map((c) => c.key);
  const defaults = columns.filter((c) => c.defaultVisible !== false || c.locked).map((c) => c.key);
  const [visible, setVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved)) {
        const keys = allKeys.filter((k) => saved.includes(k) || locked.includes(k));
        if (keys.length) return keys;
      }
    } catch { /* storage unavailable: defaults */ }
    return defaults;
  });
  const update = (keys) => {
    const next = allKeys.filter((k) => keys.includes(k) || locked.includes(k));
    setVisible(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const reset = () => update(defaults);
  return { visible, update, reset, locked };
}

export default function DataGrid({
  columns,
  rows,
  storageKey,
  rowKey = (r) => r.id,
  search = '',
  selectable = false,
  selected,
  onSelectedChange,
  rowActions,
  onRowClick,
  cardTitle,
  emptyMessage = 'Nenhum registro corresponde aos filtros.',
  rowAccent,
  bulkBar,
  onVisibleRowsChange,
}) {
  const { visible, update, locked } = useGridColumns(storageKey, columns);
  const [sort, setSort] = useState({ key: columns.find((c) => c.defaultSort)?.key || columns[0].key, dir: 'asc' });
  const [colFilters, setColFilters] = useState({});
  const [showColFilters, setShowColFilters] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const shown = columns.filter((c) => visible.includes(c.key));
  const activeColFilters = useMemo(() => Object.entries(colFilters).filter(([, v]) => v.trim()), [colFilters]);

  const filtered = useMemo(() => {
    const needle = normalizeText(search.trim());
    return rows.filter((row) => {
      for (const [key, value] of activeColFilters) {
        const col = columns.find((c) => c.key === key);
        if (!col) continue;
        const cell = col.get(row);
        const term = value.trim();
        if (term === '∅' || term.toLowerCase() === '(vazio)') {
          if (!isEmpty(cell)) return false;
        } else if (!normalizeText(cell).includes(normalizeText(term))) return false;
      }
      if (needle) {
        // Quick search looks at every column, visible or not.
        const hit = columns.some((c) => normalizeText(c.get(row)).includes(needle));
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, search, activeColFilters, columns]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) - isEmpty(vb);
      const cmp = col.numeric ? Number(va) - Number(vb) : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' });
      return cmp * sign;
    });
  }, [filtered, sort, columns]);

  // Lets the page export exactly what the grid shows (quick search + column filters).
  useEffect(() => { onVisibleRowsChange?.(sorted); }, [sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  useEffect(() => { setPage(1); }, [search, colFilters, rows.length]);
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  // Selection
  const selectedSet = selected || new Set();
  const pageKeys = pageRows.map(rowKey);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selectedSet.has(k));
  const toggleRow = (k) => {
    const next = new Set(selectedSet);
    if (next.has(k)) next.delete(k); else next.add(k);
    onSelectedChange?.(next);
  };
  const togglePage = () => {
    const next = new Set(selectedSet);
    if (allPageSelected) pageKeys.forEach((k) => next.delete(k)); else pageKeys.forEach((k) => next.add(k));
    onSelectedChange?.(next);
  };
  const selectAllFiltered = () => onSelectedChange?.(new Set(sorted.map(rowKey)));

  // Drop selections that are no longer visible after filtering
  useEffect(() => {
    if (!selectable || !selected?.size) return;
    const visibleKeys = new Set(sorted.map(rowKey));
    const kept = [...selected].filter((k) => visibleKeys.has(k));
    if (kept.length !== selected.size) onSelectedChange?.(new Set(kept));
  }, [sorted]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRows = selectable ? sorted.filter((r) => selectedSet.has(rowKey(r))) : [];
  const cardCols = shown.filter((c) => !c.locked).slice(0, 4);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2 text-sm">
        <span className="text-gray-500">
          {sorted.length === rows.length ? `${rows.length} registro(s)` : `${sorted.length} de ${rows.length} registro(s)`}
        </span>
        <button type="button" onClick={() => setShowColFilters((v) => !v)} className="text-blue-700 hover:underline font-medium hidden sm:inline">
          {showColFilters ? 'Ocultar filtros por coluna' : 'Filtrar por coluna'}
          {activeColFilters.length > 0 && ` (${activeColFilters.length})`}
        </button>
        {activeColFilters.length > 0 && (
          <button type="button" onClick={() => setColFilters({})} className="text-gray-500 hover:underline">Limpar filtros das colunas</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-gray-600">
          Por página
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {selectable && selectedSet.size > 0 && (
        <div className="bulk-bar mb-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold">{selectedSet.size} selecionado(s)</span>
          {selectedSet.size < sorted.length && (
            <button type="button" onClick={selectAllFiltered} className="text-blue-700 hover:underline">Selecionar todos os {sorted.length} filtrados</button>
          )}
          <span className="flex-1" />
          {bulkBar?.(selectedRows)}
          <button type="button" onClick={() => onSelectedChange?.(new Set())} className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">Limpar seleção</button>
        </div>
      )}

      {/* Desktop / tablet: table */}
      <div className="dg hidden sm:block">
        <div className="overflow-x-auto scrollbar-thin">
          <table>
            <thead>
              <tr>
                {selectable && (
                  <th scope="col" className="dg-check">
                    <input type="checkbox" checked={allPageSelected} onChange={togglePage} aria-label="Selecionar todos desta página" />
                  </th>
                )}
                {shown.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? 'num' : ''} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <SortHeader label={c.label} active={active} dir={sort.dir} onClick={() => toggleSort(c.key)} />
                    </th>
                  );
                })}
                <th scope="col" className="num" style={{ width: rowActions ? '6rem' : '3rem' }}>
                  <ColumnChooser columns={columns} visible={visible} onChange={update} locked={locked} />
                </th>
              </tr>
              {showColFilters && (
                <tr>
                  {selectable && <th className="dg-check" />}
                  {shown.map((c) => (
                    <th key={c.key} style={{ paddingTop: 0 }}>
                      <input
                        type="search"
                        value={colFilters[c.key] || ''}
                        onChange={(e) => setColFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                        placeholder="Filtrar…"
                        aria-label={`Filtrar coluna ${c.label}`}
                        title='Digite parte do texto. Use "(vazio)" para ver só os registros sem valor.'
                        className="dg-input w-full min-w-[6rem] normal-case font-normal tracking-normal"
                        style={{ borderColor: '#334155', textTransform: 'none' }}
                      />
                    </th>
                  ))}
                  <th />
                </tr>
              )}
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={shown.length + (selectable ? 2 : 1)} className="muted" style={{ textAlign: 'center', padding: '2rem 0.75rem' }}>{emptyMessage}</td>
                </tr>
              )}
              {pageRows.map((row) => {
                const k = rowKey(row);
                const isSel = selectedSet.has(k);
                return (
                  <tr key={k} className={isSel ? 'dg-selected' : ''} style={{ '--row-accent': rowAccent?.(row) || '#334155' }}>
                    {selectable && (
                      <td className="dg-check">
                        <input type="checkbox" checked={isSel} onChange={() => toggleRow(k)} aria-label="Selecionar registro" />
                      </td>
                    )}
                    {shown.map((c) => {
                      const content = c.render ? c.render(row) : (isEmpty(c.get(row)) ? <span className="muted">—</span> : c.get(row));
                      return (
                        <td key={c.key} className={c.numeric ? 'num' : ''}>
                          {c.locked && onRowClick
                            ? <button type="button" onClick={() => onRowClick(row)} className="dg-link text-left font-semibold hover:underline" style={{ color: 'var(--dg-text)' }}>{content}</button>
                            : <span className={c.wrap ? 'block max-w-[22rem] truncate' : 'whitespace-nowrap'} title={c.wrap ? String(c.get(row) ?? '') : undefined}>{content}</span>}
                        </td>
                      );
                    })}
                    <td className="num whitespace-nowrap">{rowActions?.(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Phone: cards */}
      <div className="sm:hidden space-y-2">
        {pageRows.length === 0 && <p className="text-sm text-gray-500 text-center py-6">{emptyMessage}</p>}
        {pageRows.map((row) => {
          const k = rowKey(row);
          return (
            <div key={k} className={`bg-white border rounded-xl p-3 ${selectedSet.has(k) ? 'border-blue-400' : 'border-[var(--color-border)]'}`}>
              <div className="flex items-start gap-2">
                {selectable && (
                  <input type="checkbox" className="mt-1" checked={selectedSet.has(k)} onChange={() => toggleRow(k)} aria-label="Selecionar registro" />
                )}
                <button type="button" onClick={() => onRowClick?.(row)} className="flex-1 text-left font-semibold text-gray-900">
                  {cardTitle ? cardTitle(row) : columns[0].get(row)}
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {cardCols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-gray-500">{c.label}</dt>
                    <dd className="text-gray-800 truncate">{isEmpty(c.get(row)) ? '—' : String(c.get(row))}</dd>
                  </div>
                ))}
              </dl>
              {rowActions && <div className="mt-2 flex justify-end gap-1 logistics-card-actions">{rowActions(row)}</div>}
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3 mt-3 text-sm" aria-label="Paginação">
          <span className="text-gray-500">Página {page} de {pageCount}</span>
          <div className="flex items-center gap-1">
            <PageButton onClick={() => setPage(1)} disabled={page === 1} label="Primeira página">«</PageButton>
            <PageButton onClick={() => setPage((p) => p - 1)} disabled={page === 1} label="Página anterior">‹</PageButton>
            <PageButton onClick={() => setPage((p) => p + 1)} disabled={page === pageCount} label="Próxima página">›</PageButton>
            <PageButton onClick={() => setPage(pageCount)} disabled={page === pageCount} label="Última página">»</PageButton>
          </div>
        </nav>
      )}
    </div>
  );
}

function PageButton({ children, onClick, disabled, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="min-w-[2rem] h-8 px-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

/** Edit / delete icon buttons for the last grid column. */
export function RowActionButtons({ onEdit, onDelete, editLabel = 'Editar', deleteLabel = 'Excluir' }) {
  return (
    <span className="inline-flex items-center gap-1">
      {onEdit && (
        <button type="button" onClick={onEdit} className="dg-chevron" title={editLabel} aria-label={editLabel}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} className="dg-chevron" title={deleteLabel} aria-label={deleteLabel} style={{ color: '#f87171' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" />
          </svg>
        </button>
      )}
    </span>
  );
}
