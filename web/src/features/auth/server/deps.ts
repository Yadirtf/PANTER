import { publicEnv } from '@/shared/config/env';
import { createSessionApi } from './session-api';

/**
 * URL de panter-api usada de servidor a servidor. Es la misma NEXT_PUBLIC_API_URL que se
 * incrusta en el build: la web no necesita variables ni secretos nuevos.
 */
export const serverApiUrl = publicEnv.NEXT_PUBLIC_API_URL;

export const sessionApi = createSessionApi({ apiUrl: serverApiUrl });
