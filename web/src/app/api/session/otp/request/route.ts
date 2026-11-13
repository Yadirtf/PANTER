import type { NextRequest } from 'next/server';
import { sessionApi } from '@/features/auth/server/deps';
import { handleOtpRequest } from '@/features/auth/server/session-routes';

export function POST(request: NextRequest) {
  return handleOtpRequest(request, { api: sessionApi });
}
