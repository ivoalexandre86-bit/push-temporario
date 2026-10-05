import { useEffect, useRef, useState } from 'react';

/**
 * Visible-column state persisted in localStorage under `storageKey`.
 * Unknown keys are dropped and `locked` columns are always kept visible.
 */
export function usePersistentColumns(storageKey, columns, locked = []) {
  const allKeys = columns.map((c) => c.key);
  const [visible, setVisible] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved)) {
        const keys = allKeys.filter((k) => saved.includes(k) || locked.includes(k));
        if (keys.length) return keys;
      }
    } catch { /* storage unavailable or corrupt: fall back to all columns */ }
    return allKeys;
  });

  const update = (keys) => {
    const next = allKeys.filter((k) => keys.includes(k) || locked.includes(k));
    setVisible(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return [visible, update];
}

/** Gear button in the grid header that opens a checklist of columns. */
export default function ColumnChooser({ columns, visible, onChange, locked = [] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = (key) => onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          // The grid scrolls sideways (overflow clips absolute children), so the
          // menu is positioned against the viewport instead.
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          setOpen((o) => !o);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        title="Escolher colunas"
        aria-label="Escolher colunas"
        className="dg-chevron"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      </button>
      {open && (
        <div className="dg-menu" role="menu" style={pos ? { position: 'fixed', top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top + 16}px)`, overflowY: 'auto' } : undefined}>
          <p className="px-2 pb-1 text-xs" style={{ color: '#8b95a7' }}>Colunas visíveis</p>
          {columns.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={visible.includes(c.key)}
                disabled={locked.includes(c.key)}
                onChange={() => toggle(c.key)}
              />
              {c.label}
            </label>
          ))}
          <button
            type="button"
            onClick={() => onChange(columns.map((c) => c.key))}
            className="w-full text-left px-2 pt-2 mt-1 text-xs border-t"
            style={{ borderColor: '#1f2a3c', color: '#93c5fd' }}
          >
            Mostrar todas
          </button>
        </div>
      )}
    </div>
  );
}

export function SortHeader({ label, active, dir, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`dg-sort${active ? ' active' : ''}`}>
      {label}
      <span className="arrow" aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : '▲▼'}</span>
    </button>
  );
}

export function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
