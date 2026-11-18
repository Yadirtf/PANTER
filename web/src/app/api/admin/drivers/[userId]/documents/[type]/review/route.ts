import type { NextRequest } from 'next/server';
import { driversRouteDeps } from '@/features/drivers/server/deps';
import { handleReviewDocument } from '@/features/drivers/server/drivers-routes';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; type: string }> },
) {
  const { userId, type } = await params;
  return handleReviewDocument(request, userId, type, driversRouteDeps);
}
