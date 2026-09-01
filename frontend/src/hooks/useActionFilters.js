import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const ARRAY_KEYS = ['projectId', 'areaId', 'status', 'businessId', 'refMonth', 'year', 'responsible'];
const STORAGE_KEY = 'projetos.filters.v1';

function readSessionDefaults() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * URL-search-param-backed filter state, so filtered views can be shared via
 * direct link. Falls back to the last filters used this session (sessionStorage)
 * when the URL carries none, and keeps sessionStorage in sync on every change.
 */
export function useActionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = {};
    const hasAnyUrlParam = [...searchParams.keys()].length > 0;
    const defaults = hasAnyUrlParam ? {} : readSessionDefaults();

    for (const key of ARRAY_KEYS) {
      const fromUrl = searchParams.getAll(key);
      out[key] = fromUrl.length ? fromUrl.flatMap((v) => v.split(',')).filter(Boolean) : (defaults[key] || []);
    }
    const scalarKeys = ['startFrom', 'startTo', 'endFrom', 'endTo', 'q', 'overdue', 'unassigned', 'plannedMin', 'plannedMax', 'actualMin', 'actualMax', 'dueSoonDays'];
    for (const key of scalarKeys) {
      out[key] = searchParams.get(key) ?? defaults[key] ?? '';
    }
    return out;
  }, [searchParams]);

  const setFilters = useCallback((next) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (Array.isArray(value)) {
        if (value.length) params.set(key, value.join(','));
      } else if (value !== '' && value !== undefined && value !== null && value !== false) {
        params.set(key, value);
      }
    }
    setSearchParams(params, { replace: true });
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  }, [filters, setSearchParams]);

  const clearAll = useCallback(() => {
    setSearchParams({}, { replace: true });
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, [setSearchParams]);

  const activeCount = useMemo(() => {
    let n = 0;
    for (const key of ARRAY_KEYS) n += (filters[key]?.length || 0) > 0 ? 1 : 0;
    for (const key of ['startFrom', 'startTo', 'endFrom', 'endTo', 'q', 'overdue', 'unassigned']) {
      if (filters[key]) n += 1;
    }
    return n;
  }, [filters]);

  const asQueryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value)) { if (value.length) params.set(key, value.join(',')); }
      else if (value) params.set(key, value);
    }
    return params.toString();
  }, [filters]);

  return { filters, setFilters, clearAll, activeCount, asQueryString };
}
