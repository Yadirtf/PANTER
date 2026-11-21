import type { NextRequest } from 'next/server';
import { handleAreaHistory } from '@/features/catalog/server/catalog-routes';
import { catalogRouteDeps } from '@/features/catalog/server/deps';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAreaHistory(request, id, catalogRouteDeps);
}
