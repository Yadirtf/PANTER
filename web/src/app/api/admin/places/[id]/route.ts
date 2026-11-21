import type { NextRequest } from 'next/server';
import { handleUpdatePlace } from '@/features/catalog/server/catalog-routes';
import { catalogRouteDeps } from '@/features/catalog/server/deps';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleUpdatePlace(request, id, catalogRouteDeps);
}
