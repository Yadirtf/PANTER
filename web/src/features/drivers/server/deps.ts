import { refreshSession, serverApiUrl } from '@/features/auth/server/deps';
import { createDriversApi } from './drivers-api';
import type { DriversRouteDeps } from './drivers-routes';

export const driversApi = createDriversApi({ apiUrl: serverApiUrl });

export const driversRouteDeps: DriversRouteDeps = { drivers: driversApi, refresh: refreshSession };
