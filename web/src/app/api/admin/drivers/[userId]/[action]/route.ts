import type { NextRequest } from 'next/server';
import { driversRouteDeps } from '@/features/drivers/server/deps';
import { handleDriverAction } from '@/features/drivers/server/drivers-routes';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; action: string }> },
) {
  const { userId, action } = await params;
  return handleDriverAction(request, userId, action, driversRouteDeps);
}
