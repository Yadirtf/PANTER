import { refreshSession, serverApiUrl } from '@/features/auth/server/deps';
import { createAdminApi } from './admin-api';
import type { AdminRouteDeps } from './admin-routes';

export const adminApi = createAdminApi({ apiUrl: serverApiUrl });

export const adminRouteDeps: AdminRouteDeps = { admin: adminApi, refresh: refreshSession };
