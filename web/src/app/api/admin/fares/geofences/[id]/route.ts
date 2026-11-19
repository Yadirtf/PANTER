import type { NextRequest } from 'next/server';
import { faresRouteDeps } from '@/features/fares/server/deps';
import { handleUpdateGeofence } from '@/features/fares/server/fares-routes';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleUpdateGeofence(request, id, faresRouteDeps);
}
