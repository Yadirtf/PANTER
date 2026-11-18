import { publicEnv } from '@/shared/config/env';
import { createRefreshCoordinator } from './session-call';
import { createSessionApi } from './session-api';

/**
 * URL de panter-api usada de servidor a servidor. Es la misma NEXT_PUBLIC_API_URL que se
 * incrusta en el build: la web no necesita variables ni secretos nuevos.
 */
export const serverApiUrl = publicEnv.NEXT_PUBLIC_API_URL;

export const sessionApi = createSessionApi({ apiUrl: serverApiUrl });

/** Refresh compartido por los route handlers: un refresh token se gasta una vez por isolate. */
export const refreshSession = createRefreshCoordinator((token) => sessionApi.refresh(token));
