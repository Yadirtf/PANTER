import type { NextRequest } from 'next/server';
import { refreshSession } from '@/features/auth/server/deps';
import { handleRefreshRedirect } from '@/features/auth/server/session-routes';

export function GET(request: NextRequest) {
  return handleRefreshRedirect(request, { refresh: refreshSession });
}
