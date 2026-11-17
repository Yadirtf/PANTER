import type { NextRequest } from 'next/server';
import { createApiJwks } from '@/features/auth/server/access-token';
import { serverApiUrl, sessionApi } from '@/features/auth/server/deps';
import { createSessionMiddleware } from '@/features/auth/server/session-middleware';

/**
 * Sesión y navegación por rol de la web (HU-107). Corre dentro del Worker de OpenNext (runtime
 * edge): jose usa WebCrypto y el JWKS queda en caché en la memoria del isolate.
 */
const sessionMiddleware = createSessionMiddleware({
  api: sessionApi,
  keys: createApiJwks(serverApiUrl),
});

export function middleware(request: NextRequest) {
  return sessionMiddleware(request);
}

export const config = {
  matcher: ['/login', '/admin/:path*', '/despacho/:path*', '/operador/:path*'],
};
