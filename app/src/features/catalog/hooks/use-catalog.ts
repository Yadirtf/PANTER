// Listas del catálogo para la pantalla "¿A dónde vas?": red con respaldo de la copia guardada.
import { useCallback, useEffect, useState } from 'react';
import { toApiError } from '../../../shared/api/errors';
import type { CatalogResult } from '../catalog-repository';
import { catalogRepository } from '../instance';

export type CatalogListState<T> =
  | { status: 'loading' }
  | { status: 'ready'; result: CatalogResult<T> }
  | { status: 'error'; code: string };

function useCatalogList<T>(load: (refresh: boolean) => Promise<CatalogResult<T>>) {
  const [state, setState] = useState<CatalogListState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }));
    load(attempt > 0).then(
      (result) => alive && setState({ status: 'ready', result }),
      (error: unknown) => alive && setState({ status: 'error', code: toApiError(error).code }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, reload] as const;
}

export function useCatalogAreas() {
  return useCatalogList((refresh) => catalogRepository.areas({ refresh }));
}

export function useCatalogPlaces() {
  return useCatalogList((refresh) => catalogRepository.places({ refresh }));
}
