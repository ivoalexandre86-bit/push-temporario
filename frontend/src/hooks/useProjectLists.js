import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Per-project choice of responsáveis and áreas/processos (set on the project
 * page). `listsFor(projectId)` gives the allowed ids, or null for a list the
 * project left empty, meaning every active item is offered. Fetched again
 * whenever `reloadKey` changes (e.g. each time a form opens).
 */
export function useProjectLists(reloadKey) {
  const [byProject, setByProject] = useState({});

  useEffect(() => {
    let cancelled = false;
    api.get('/projects/lists')
      .then((d) => {
        if (cancelled) return;
        setByProject(Object.fromEntries((d.items || []).map((i) => [String(i.projectId), i])));
      })
      .catch(() => { /* forms fall back to the full lists */ });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const listsFor = (projectId) => {
    const entry = byProject[String(projectId)];
    return {
      personIds: entry?.personIds?.length ? entry.personIds : null,
      areaIds: entry?.areaIds?.length ? entry.areaIds : null,
    };
  };

  return { listsFor };
}

/** Whether a value picked in a form is still offered for the given project. */
export function isOffered(allowedIds, id) {
  return !allowedIds || allowedIds.includes(Number(id));
}
