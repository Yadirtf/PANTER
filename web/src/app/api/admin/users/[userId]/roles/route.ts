import type { NextRequest } from 'next/server';
import { handleGrantRole } from '@/features/admin/server/admin-routes';
import { adminRouteDeps } from '@/features/admin/server/deps';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  return handleGrantRole(request, userId, adminRouteDeps);
}
