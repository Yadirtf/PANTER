import type { NextRequest } from 'next/server';
import { sessionApi } from '@/features/auth/server/deps';
import { handleOtpVerify } from '@/features/auth/server/session-routes';

export function POST(request: NextRequest) {
  return handleOtpVerify(request, { api: sessionApi });
}
