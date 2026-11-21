import { refreshSession, serverApiUrl } from '@/features/auth/server/deps';
import { createCatalogApi } from './catalog-api';
import type { CatalogRouteDeps } from './catalog-routes';

export const catalogApi = createCatalogApi({ apiUrl: serverApiUrl });

export const catalogRouteDeps: CatalogRouteDeps = { catalog: catalogApi, refresh: refreshSession };
