import { refreshSession, serverApiUrl } from '@/features/auth/server/deps';
import { createFaresApi } from './fares-api';
import type { FaresRouteDeps } from './fares-routes';

export const faresApi = createFaresApi({ apiUrl: serverApiUrl });

export const faresRouteDeps: FaresRouteDeps = { fares: faresApi, refresh: refreshSession };
