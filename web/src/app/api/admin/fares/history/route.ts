import type { NextRequest } from 'next/server';
import { faresRouteDeps } from '@/features/fares/server/deps';
import { handleFareHistory } from '@/features/fares/server/fares-routes';

export function GET(request: NextRequest) {
  return handleFareHistory(request, faresRouteDeps);
}
