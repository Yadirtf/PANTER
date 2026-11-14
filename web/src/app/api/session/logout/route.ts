import type { NextRequest } from 'next/server';
import { sessionApi } from '@/features/auth/server/deps';
import { handleLogout } from '@/features/auth/server/session-routes';

export function POST(request: NextRequest) {
  return handleLogout(request, { api: sessionApi });
}
