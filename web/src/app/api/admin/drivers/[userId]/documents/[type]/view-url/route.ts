import type { NextRequest } from 'next/server';
import { driversRouteDeps } from '@/features/drivers/server/deps';
import { handleDocumentViewUrl } from '@/features/drivers/server/drivers-routes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; type: string }> },
) {
  const { userId, type } = await params;
  return handleDocumentViewUrl(request, userId, type, driversRouteDeps);
}
