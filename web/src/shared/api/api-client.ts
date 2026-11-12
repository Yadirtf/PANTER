import { publicEnv } from '../config/env';
import { createHttpClient } from './http-client';

/** Cliente de la API de PANTER para el entorno actual (NEXT_PUBLIC_API_URL). */
export const apiClient = createHttpClient({ baseUrl: publicEnv.NEXT_PUBLIC_API_URL });
