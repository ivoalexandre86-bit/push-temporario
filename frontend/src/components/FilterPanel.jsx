import { useState } from 'react';

const COLLAPSED_KEY = 'filtros.minimizados';

function readCollapsed() {
  // Minimized unless the user chose to show them.
  try { return localStorage.getItem(COLLAPSED_KEY) !== '0'; } catch { return true; }
}

/**
 * Shared minimized/shown state for filter panels. Starts minimized; the
 * user's choice is remembered (localStorage) and shared by every page.
 */
export function useFiltersCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };
  return [collapsed, toggle];
}

const FunnelIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

/** Compact "Filtros" button for a page header; shows how many filters are active. */
export function FilterToggleButton({ collapsed, onToggle, activeCount = 0 }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium ${activeCount > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
    >
      <FunnelIcon />
      {collapsed ? 'Filtros' : 'Ocultar filtros'}
      {activeCount > 0 && (
        <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center">
          {activeCount}
        </span>
      )}
    </button>
  );
}

/**
 * Card that holds a page's filters, with a header that minimizes it to one
 * line. Uncontrolled by default (own remembered state); pass `collapsed` and
 * `onToggle` to control it from the page, e.g. with a FilterToggleButton.
 * Active filters keep applying while minimized.
 */
export default function FilterPanel({ activeCount = 0, onClear, children, collapsed: controlled, onToggle }) {
  const [ownCollapsed, ownToggle] = useFiltersCollapsed();
  const collapsed = controlled ?? ownCollapsed;
  const toggle = onToggle ?? ownToggle;

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl mb-4">
      <div className={`flex items-center gap-2 px-3 md:px-4 py-2 ${collapsed ? '' : 'border-b border-gray-100'}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Filtros
          {activeCount > 0 && (
            <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </button>
        <span className="text-xs text-gray-400">
          {collapsed ? (activeCount > 0 ? 'minimizados, continuam aplicados' : 'minimizados') : ''}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {onClear && activeCount > 0 && (
            <button type="button" onClick={onClear} className="text-sm font-medium text-blue-700 hover:underline">
              Limpar ({activeCount})
            </button>
          )}
          <button type="button" onClick={toggle} className="text-sm text-gray-500 hover:text-gray-800">
            {collapsed ? 'Mostrar' : 'Minimizar'}
          </button>
        </div>
      </div>
      {!collapsed && <div className="p-3 md:p-4">{children}</div>}
    </div>
  );
}
