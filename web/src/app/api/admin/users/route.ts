import type { NextRequest } from 'next/server';
import { handleListUsers } from '@/features/admin/server/admin-routes';
import { adminRouteDeps } from '@/features/admin/server/deps';

export function GET(request: NextRequest) {
  return handleListUsers(request, adminRouteDeps);
}
