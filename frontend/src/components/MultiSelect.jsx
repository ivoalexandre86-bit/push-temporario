import { useEffect, useMemo, useRef, useState } from 'react';

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Accessible multi-select dropdown (checkbox list in a popover), with a
 * type-to-filter search box and a "select all" shortcut. Values inside one
 * MultiSelect combine with OR logic when sent to the API.
 */
export default function MultiSelect({ label, options, value = [], onChange, placeholder = 'Todos' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const needle = normalize(search);
    return options.filter((o) => normalize(o.label).includes(needle));
  }, [options, search]);

  const toggle = (val) => {
    if (value.includes(val)) onChange(value.filter((v) => v !== val));
    else onChange([...value, val]);
  };

  const selectAllVisible = () => {
    const merged = new Set(value);
    for (const o of filteredOptions) merged.add(String(o.value));
    onChange(Array.from(merged));
  };

  const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every((o) => value.map(String).includes(String(o.value)));

  const summary = value.length === 0
    ? placeholder
    : value.length === options.length && options.length > 0
      ? 'Todos'
      : value.length === 1
        ? (options.find((o) => String(o.value) === String(value[0]))?.label || value[0])
        : `${value.length} selecionados`;

  return (
    <div className="relative" ref={ref}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full min-w-[9rem] flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
      >
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-gray-400">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 w-64 max-h-80 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg flex flex-col"
        >
          <div className="p-2 border-b border-gray-100">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 text-xs">
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={filteredOptions.length === 0 || allVisibleSelected}
              className="text-blue-600 hover:underline font-medium disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
            >
              Selecionar {search.trim() ? 'visíveis' : 'todos'}
            </button>
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-gray-500 hover:underline font-medium">
                Limpar seleção
              </button>
            )}
          </div>

          <div className="overflow-y-auto scrollbar-thin py-1">
            {filteredOptions.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhuma opção encontrada</p>}
            {filteredOptions.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.map(String).includes(String(opt.value))}
                  onChange={() => toggle(String(opt.value))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
