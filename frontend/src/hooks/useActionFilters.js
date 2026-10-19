import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ARRAY_KEYS = ['projectId', 'areaId', 'status', 'projectStatus', 'businessId', 'refMonth', 'year', 'responsible'];
const SCALAR_KEYS = ['startFrom', 'startTo', 'endFrom', 'endTo', 'q', 'overdue', 'unassigned', 'plannedMin', 'plannedMax', 'actualMin', 'actualMax', 'dueSoonDays'];
const FILTER_KEYS = [...ARRAY_KEYS, ...SCALAR_KEYS];
const STORAGE_PREFIX = 'projetos.filters.v2';

const storageKey = (userId) => `${STORAGE_PREFIX}.${userId ?? 'anon'}`;

function readSaved(userId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId)) || '{}');
  } catch {
    return {};
  }
}

function writeSaved(userId, filters) {
  try {
    const compact = {};
    for (const [key, value] of Object.entries(filters)) {
      if (Array.isArray(value) ? value.length : value) compact[key] = value;
    }
    if (Object.keys(compact).length) localStorage.setItem(storageKey(userId), JSON.stringify(compact));
    else localStorage.removeItem(storageKey(userId));
  } catch { /* ignore */ }
}

/**
 * Filter state shared by Painel, Ações, Horas and Relatórios. The URL carries
 * the filters so a filtered view can be shared via direct link; the last
 * filters each user chose are also kept in localStorage, so they stay applied
 * across pages, reloads and new visits until the user clears them. Filters in
 * the URL (e.g. opening a project) override the saved ones key by key.
 */
export function useActionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id;
  // Bumped on every change: the URL can stay the same while the saved
  // filters change (e.g. clearing one that only came from storage).
  const [version, setVersion] = useState(0);

  const filters = useMemo(() => {
    const out = {};
    const saved = readSaved(userId);
    const urlHas = (key) => searchParams.has(key);

    for (const key of ARRAY_KEYS) {
      out[key] = urlHas(key)
        ? searchParams.getAll(key).flatMap((v) => v.split(',')).filter(Boolean)
        : (Array.isArray(saved[key]) ? saved[key] : []);
    }
    for (const key of SCALAR_KEYS) {
      out[key] = urlHas(key) ? searchParams.get(key) : (saved[key] ?? '');
    }
    return out;
  }, [searchParams, userId, version]);

  // Keep the saved copy in step with what is applied (including filters that
  // arrived through a link).
  useEffect(() => { if (userId) writeSaved(userId, filters); }, [filters, userId]);

  const setFilters = useCallback((next) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (!FILTER_KEYS.includes(key)) continue;
      if (Array.isArray(value)) {
        if (value.length) params.set(key, value.join(','));
      } else if (value !== '' && value !== undefined && value !== null && value !== false) {
        params.set(key, value);
      }
    }
    writeSaved(userId, merged);
    setVersion((v) => v + 1);
    setSearchParams(params, { replace: true });
  }, [filters, setSearchParams, userId]);

  const clearAll = useCallback(() => {
    writeSaved(userId, {});
    setVersion((v) => v + 1);
    setSearchParams({}, { replace: true });
  }, [setSearchParams, userId]);

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
