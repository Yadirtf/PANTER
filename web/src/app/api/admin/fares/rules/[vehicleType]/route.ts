import type { NextRequest } from 'next/server';
import { faresRouteDeps } from '@/features/fares/server/deps';
import { handleUpdateRule } from '@/features/fares/server/fares-routes';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleType: string }> },
) {
  const { vehicleType } = await params;
  return handleUpdateRule(request, vehicleType, faresRouteDeps);
}
