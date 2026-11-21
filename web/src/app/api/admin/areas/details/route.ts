import type { NextRequest } from 'next/server';
import { handleAreaDetails } from '@/features/catalog/server/catalog-routes';
import { catalogRouteDeps } from '@/features/catalog/server/deps';

export function GET(request: NextRequest) {
  return handleAreaDetails(request, catalogRouteDeps);
}
