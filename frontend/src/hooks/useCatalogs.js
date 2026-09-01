import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Fetches projects, areas and people catalogs once for filter/select dropdowns. */
export function useCatalogs() {
  const [projects, setProjects] = useState([]);
  const [areas, setAreas] = useState([]);
  const [people, setPeople] = useState([]);
  const [refMonths, setRefMonths] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/projects'), api.get('/areas'), api.get('/people'), api.get('/actions/meta/ref-months')])
      .then(([p, a, pe, rm]) => {
        if (cancelled) return;
        setProjects(p.items || []);
        setAreas(a.items || []);
        setPeople(pe.items || []);
        setRefMonths(rm.items || []);
      })
      .catch(() => { /* surfaced by individual pages as needed */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { projects, areas, people, refMonths, loading };
}
