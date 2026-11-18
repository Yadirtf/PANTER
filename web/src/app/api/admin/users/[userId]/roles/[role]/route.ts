import type { NextRequest } from 'next/server';
import { handleRevokeRole } from '@/features/admin/server/admin-routes';
import { adminRouteDeps } from '@/features/admin/server/deps';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; role: string }> },
) {
  const { userId, role } = await params;
  return handleRevokeRole(request, userId, role, adminRouteDeps);
}
