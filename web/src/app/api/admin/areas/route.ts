import type { NextRequest } from 'next/server';
import { handleCreateArea } from '@/features/catalog/server/catalog-routes';
import { catalogRouteDeps } from '@/features/catalog/server/deps';

export function POST(request: NextRequest) {
  return handleCreateArea(request, catalogRouteDeps);
}
