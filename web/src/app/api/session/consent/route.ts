import type { NextRequest } from 'next/server';
import { refreshSession, sessionApi } from '@/features/auth/server/deps';
import { handleConsent } from '@/features/auth/server/session-routes';

export function POST(request: NextRequest) {
  return handleConsent(request, { api: sessionApi, refresh: refreshSession });
}
